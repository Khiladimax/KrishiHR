// src/controllers/offerLetterController.js
// Generate, preview, and email offer letters

const db         = require('../config/db');
const emailSvc   = require('../config/emailService');
const { execFile } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');

// ── Company details — override any of these via environment variables ──────────
const COMPANY = {
  name:       process.env.COMPANY_NAME       || 'Krishi Care & Management Services Private Limited',
  cin:        process.env.COMPANY_CIN        || 'U01403MH2015PTC261465',
  officeAddr: process.env.COMPANY_OFFICE_ADDR|| '617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi Jogeshwari (East), Mumbai - 400060',
  corpAddr:   process.env.COMPANY_CORP_ADDR  || 'H-12, Green Park Extension, New Delhi - 110016',
  email:      process.env.COMPANY_EMAIL      || 'hr@krishicare.in',
  website:    process.env.COMPANY_WEBSITE    || 'www.krishicare.in',
  tel:        process.env.COMPANY_TEL        || '+912268284109',
};

// ── DB Init ────────────────────────────────────────────────────────────────────
exports.initTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS offer_letters (
        id                SERIAL PRIMARY KEY,
        employee_id       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        -- Candidate info (may not be employee yet)
        candidate_name    VARCHAR(200) NOT NULL,
        candidate_email   VARCHAR(200),
        candidate_address TEXT,
        candidate_mobile  VARCHAR(20),
        -- Position
        designation       VARCHAR(200) NOT NULL,
        location          VARCHAR(200) DEFAULT 'Mumbai',
        joining_date      DATE,
        offer_date        DATE DEFAULT CURRENT_DATE,
        offer_valid_days  INT DEFAULT 7,
        -- Salary
        ctc_annual        NUMERIC(14,2) DEFAULT 0,
        basic_monthly     NUMERIC(12,2) DEFAULT 0,
        hra_monthly       NUMERIC(12,2) DEFAULT 0,
        conveyance_monthly NUMERIC(12,2) DEFAULT 0,
        other_allowance_monthly NUMERIC(12,2) DEFAULT 0,
        gratuity_monthly  NUMERIC(12,2) DEFAULT 0,
        pf_employee_monthly NUMERIC(12,2) DEFAULT 0,
        pf_employer_monthly NUMERIC(12,2) DEFAULT 0,
        pf_admin_monthly  NUMERIC(12,2) DEFAULT 0,
        -- Custom fields (extra notes/clauses)
        probation_months  INT DEFAULT 6,
        notice_period_months INT DEFAULT 3,
        custom_clauses    TEXT,
        -- Status
        status            VARCHAR(20) DEFAULT 'draft', -- draft/sent/accepted/rejected
        sig1_image        TEXT,   -- base64 authorized signatory signature
        sig2_image        TEXT,   -- base64 HR signatory signature
        sent_at           TIMESTAMP,
        created_by        INTEGER REFERENCES employees(id),
        created_at        TIMESTAMP DEFAULT NOW(),
        updated_at        TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Offer letter table ready');

    // Migration: add signature columns if not exist
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS sig1_image TEXT`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS sig2_image TEXT`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS professional_tax_monthly NUMERIC(12,2) DEFAULT 0`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50)`);
    console.log('✅ Offer letter signature columns ready');
  } catch (err) {
    console.error('❌ Offer letter table init error:', err.message);
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function indianNumber(n) {
  if (!n) return '0';
  return Number(n).toLocaleString('en-IN');
}

function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';
  if (num < 0) return 'Minus ' + numberToWords(-num);

  let words = '';
  if (Math.floor(num / 10000000) > 0) {
    words += numberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  if (Math.floor(num / 100000) > 0) {
    words += numberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  if (Math.floor(num / 1000) > 0) {
    words += numberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  if (Math.floor(num / 100) > 0) {
    words += numberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  if (num > 0) {
    if (num < 20) { words += ones[num] + ' '; }
    else { words += tens[Math.floor(num / 10)] + ' ' + ones[num % 10] + ' '; }
  }
  return words.trim();
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const day = dt.getDate();
  const months = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
  return `${day}${suffix} ${months[dt.getMonth()]}, ${dt.getFullYear()}`;
}

function buildOfferLetterHTML(ol) {
  const basic    = parseFloat(ol.basic_monthly||0);
  const hra      = parseFloat(ol.hra_monthly||0);
  const conv     = parseFloat(ol.conveyance_monthly||0);
  const other    = parseFloat(ol.other_allowance_monthly||0);
  const gratuity = parseFloat(ol.gratuity_monthly||0);
  const pfEmp    = parseFloat(ol.pf_employee_monthly||0);
  const pfEmpr   = parseFloat(ol.pf_employer_monthly||0);
  const pfAdmin  = parseFloat(ol.pf_admin_monthly||0);
  const pt       = parseFloat(ol.professional_tax_monthly||0);

  const gross      = basic + hra + conv + other + gratuity;
  const totalDed   = pfEmp + pt;
  const netSalary  = gross - totalDed;
  const ctcMonthly = gross + pfEmpr + pfAdmin;
  const ctcAnnual  = parseFloat(ol.ctc_annual || (ctcMonthly * 12));

  const fmtV = v => Number(Math.round(v)).toLocaleString('en-IN');

  // ordinal joining date  e.g. 17<sup>th</sup> May 2026
  function joiningDateHTML(d) {
    if (!d) return '';
    const dt = new Date(d);
    const day = dt.getDate();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const sup = [,'st','nd','rd'][day] || 'th';
    return `${day}<sup>${sup}</sup> ${months[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  const probWords  = {3:'three',6:'six',12:'twelve'};
  const noticeWords= {1:'one',2:'two',3:'three',6:'six'};
  const probStr    = probWords[ol.probation_months]    || `${ol.probation_months||6}`;
  const noticeStr  = noticeWords[ol.notice_period_months] || `${ol.notice_period_months||3}`;

  const LOGO_B64 = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFIAAABMCAYAAAD+8OBwAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAEeBSURBVHhehZwFdJR32vbZV3e/3W4dqOBO3J0I8cxMJoZToBSo7Xar2+IEC5GZySTBvXihOBQrrpHRJLglGYsg9Xbb33fuZ9Ldffe857w553+GTKaTea7nluu+rjvt0uX/+FIZQmJVxjB9VkXkxazKqDvpxkiyyqNQG6LR6KPRGCJRl4ejNkSg0Ucpz8nP5DWZf39tJBpDBNn6CLJ1kWh10WTrY9EYhqEpl8do1LoYNGWxaHRRaHSRaPSxqPXxqA1xqAzRZJZHkmmMQFUeqbxfdrmcKDTlMajLY1BVRJBlDENliEJliEFVLq8N7/xePtOv/11054kguzy880Sg6bymtKIQsuW6SqLu5JbEXhxdkqIfszgrec7JOf/xr9j8n1/xc+L/I70ieIKqIviY2hiEqjwYdWUkmVVRpMvFVESiNkYqHzarPJxMo/dkKd9HoTJGkyWnQk4UWRWR3mOMQlUejVoBMVYBQVMeiUYuxBCDRh+HWh+jXJCAkVUeo9yMTGMYGRXhZMjvqJDfH466IgxNRQTqiijl82RVhJFVEYpKPpf8noow7zFGKJ9VrTx6wc0yhpIl11Xx6wlR3jPLGEF2VSzZlTFkG6PJNcYyojyeUbpExuhST72mL5iy/f723/0rXv/rV0Fl/B/SKoN3pxkDyTIEojEEo9Z777S6PA6NMbbzQ4UrR4mETpCUCPz1QgQwiRRjtPJ8RoUceY0AFKs8r0SMXJBys+QiY8gs977eC34EmZWhZFYGdwIl7x3hBbAyDHWlABqpgCn/1lTKz6LQVESjqQhXTnZFJNnGKG/UCZASEJVhqKpCUFUFKUe9NBRVpfwsmlR9BFmVsaQbIsjQhZFTGU2OPhJNcRgjyxKYVpF/bLdp3VP/itv/+MqsDOueVhlky6wKRbM0Aq18MH0oGn042vJYtJJqZZLO4ajLQ8kyhJJpCCfLEEmmIZKM8ggy5Y4bIlAZIlHpo5SfyfPpxnDSjPIYRYYxSolkiXSV0Z8sox8ZxmAl4ryvCyXdGEpmRQiZlYFkVgSiKg9DLTdTuaESlZ0RJ6AaI9HIMUQo6Su/W26yxhimRLyUgGwltSWiBchwsipDyJIbpNykUO/z5ZJBcWRWxKJeOkyJzkx9qJL++VVR5OgiyCmK4oP1rzaevPPF4H/FT/nS6iOGpOuDDsiHV2qaXupYFFqpKxLyhii0+jhyBFD5Xu620VtztJKmhpi/p5BEjNYYRU65pEgUaknHyggyq/5x1Eq0hJJdGYC6yo+sykAyKkNJrwohY2kIWVUhqCvlBJFdGUxOeRR5+jhy9XFopSRURqKuilAesyuiyTHGKqkoP5O0zK6MRFsZSU6FpGiMcuQzqculbktZkhsZ5s0quTFS1/UxZFcmoq6MJ6OzzkuaSyRnlQWjMYRSUBnDKF0yi3bMPH7n6+tB/4pjl/zyiN0qYzBZ5WFodDHk6Ieh0UtUSd0J8d5hQ4wCnPLv8nDl51p5bVmc8ijfK41HwJRIMHRGglICQsmqDCWjMoTMilAlqrW6CLSGUNTlktohZEokVoSQUSGRGoymPBiNMQiNMZhcfRR5ZXHklg0jWy8lQ9Je0l2yIxKtPpYcfSzZ0likvHRGrESvEpGdtVhuvjdK//n8o0kqjc0QpdR4dYUAK41Lfkc4OVWRZOqCKShP5NXSfL689sXJ/wGitih4Qp5eIkTqQgTqkmFo9Qlk6STkJVL8STcGkq4L83ZjpRtGkl0ag3ZJHDlFw8gpiUNVEkmWznth8mFVUm/KwrzvUx5MlpK+QcrN0pZGo10QQ05RLOolUahLJAtilPfN0oeRrQsnu1TSSoAORVseTY5uGPmGJLKWRJEp710VoZSDTPns0vFLJVukBktdlbIQojQWyRABNcsYgsYYSrYxTElXrdyAvzOATqClhhokE+RmSC2W78PIrpTa641mdWkME3Qq9J/Pw/Vdy2v/ALI4uDFXJxcdTo4hkfySNEaWp6E1RqOpkg4XSJY+lJzyRHKMSWgrExSgR5WlM65MzeglGYwsSSO/JAlVUTSqkhiy9cPIMQwjRxdHri5OoT2qslBU+jCyiiMYUZTM5NJ8XisfyURjHiPLMtAujiendBj5+gRGlMqJp6AyXmkgWXqJ3mHklyYzypCBtjzBywyU+hdHftlwRupTyTHEKUBKmcioClWiXBqRt1mFoK6QKA8hu1zAlGgVEKURSZrLa4NRVYYoNTvdEIxmqTQyaWiRZOjkpsSgLolgnC6Bd4z5XG+vu6GAqNKFqnN0keTqhDtF8+fNE1h32Yjh1FwmrskibXEAuboY5hx8m7W15Sw6PoNRS9W8s/U11l6qZFvNGrbWrOLT6qWsvFjG/AMfMaEqF/XCeMaUZzF3319YdaWYBYffZdzSdLTFsby6LAfdgUJ2V29ln20XO21bWH5Gx8eb36RgUSpvrBzNslMLWXlhMW98OlLJkjR9OFm6GD7a/jqrLupZ9OUnjFqegbokjhkH3mT5xWIWH/6E0cZUsnQRZFaEe5uKsAslIn9tUAKmlKowpfZJ5igsRKhTZTAZFQGol4cgDTfdGKy8R7ohtLOpdfLO4gDGlvjx8So1tx6d4ftfWtVd1IaIYiHSWl0s2uJhlByZiYsb1D4+xftbXmX4J0FM3/4GF1q/4Po3daw4r2OMXkvlmRLu/K0Rx093uP6VlYbHNVz/0Yzp6/OsvmhkkmEEkwwF7LSt5x529jRsYFJFLuP0ajZUV3L9WytN39yh4UE9tsdmbN9dYWNNJWOXqJm57R3MbWdo+P4Sc/a/S3pxFKll4WQURbPucgW3vrfzheNzXls9isx5sWwwG7nxo4kv7uxkYoVGyDRqhc96m4vUQKVuKhy4s3YqFE6el9d1pr5EYmUQmVUhpBmFHkWiWRqj3IzsKun6AeToh5JX3IdPtkXzWd073P36GD/80rykS5Yh6mKWNAldDNmL46g4voCOX5poaK/hw9VvMHFJAUdv7OHeDw0ctu3gdd1Y8grTWXmqnKbvb9LosbDmi2WUf17MscYD3P/pBtaOKyzZPYc3dK+w37QNN3fYb93GNONY5u36CHPbBVq+u8PBC/tYsnkRxfsXsfpyOYV73mfEgnRmb30PW9tFbnxrYuHeT1AtjCdzcTTZCxPYeGYZjm/vcNZ5jLdXTUI7O4ltphXc/7GR4zf28Jo+B+1iKS1C+H9lHjIB/Qqml/sqIHbyXCHx0rS8nNVL/tOlxstAIbXTGE5OZSha3SDySrrzyY5A9t4YzwXHTO5/c5Dvfrl3sYtKH3ktS3ih8LPFMRiPLuDRz25szbUUrp/ByqOV3P3+GpfufcmMNX8iZ0YCoxans+aUAed3d6i9dZG3i6aieTudsu2LuP7Iyr3vG1l+pJS3yl7hUO0OOn5p5oD5M6box1Gyfz7XHllpeXybdbuWM+qvuWTPTlHq7ciyZLQLEpmz433sbZe5+dDM4u3T0c5ORFsYT8HcFDYdX4nrm3ucaz7OW0snkjszme21K7n3YyMnbxxgii6XnMUxaIXKSI2X0VQZYyM6pxyph9JYojtPJ8AVAnCYd0KrEHDjUBvjUOnCyJZaqRtCvq4n737alz3X87B8+w6nb73DjdbP+PGXlmtdhEpk6UNQC6cqjcZwvJAHP3u44bnGgdq92NrMXG23ot+zkLz5SWQvjGZMWTKrTpbQ/O11LC1XWLh5Du9X/ont5zdy//ur2FovsGTHJ7xZOob91Vvw/O0u+63bmVI+jukb3+fK/bO0/9iC7e5lVhwp4/VVo1EXRZGxMISsBdHM3vkeDW3VOL65zvazq5m36V3mbX6H+Rvf44RpP23ft3C++ThvV00kZ0YS22qWKxF54tpeJuu1aJfILB2jNCmVNBGl0XhTWqJLWx6BVqFEv048Ukc7m1J5GCplhhe+Krw5klyDP5rinryxrj/b7OnUffUq552vsP6YljPWZXz/i5suWuly+hCy9MFoyqLRnyjkwS8e3N+6uPf1HTw/uTh77RRvlU0ic24Y2aURSjddc6oU57d3cH/XTG3zRWqbz3Pvm6vcfGxiy9mlTC3NZ4oun33mzbh/uc1B+3amGkczviiPpUd0mJwX8fx4jxvfWjh4cxvzD77HmPJUVPNimfPZBwqQX/3i5u7XDVjbL1LXfgZL6wWav77F45/bOHf/OO8sf42cmUlsulxF0w+NnLq+j8nlWjQlMkREo6kUIAUgaSShCqA55aHkGcLINQj1EcC8PFdGTo2MnQo9km4ei9YgfDqM7OJ+TFj2Miuqk7j4aDwX28dRdSKOP5UHsvtiBY/+5qKLpnyYd5DXh/49Ih/+7Mbx8D72ZhOOr5uwNlsp/PQTshdGoSoOZpQugbWndLi/aaL9Ww833I24v7lHx9+aOGH7nHeNE9HOjGdyZR677Ztw/HKLg/atvF45kuzZiYwrzmXBzhkctO+iscOK86f71LWfo/TgbEbOz2Te1o+41mri8Y8uGlx1nLv9JSfvHOHM7RPcenCNBz+3cu7eCf6yfCraWcPZXL2U5h8bOdW4l1eN2ahLvZOYgJRZLh3XC6JQnjx9CPn6EHKFTslwUSGzvegFMquLEBJMtkKPBOgIcnQBjCrvS9GxIM49GqsAuex0FJMq+zKmKJxddRt4SBtdMvWd4W8IQ7MkhorjC3n0s4fGJgvr9i/jtP0Ynh+dHG3YxxvLC8iYF8So0iRWS438tgX7XRvLd1ZwtHYf7h/ucPHmUWasepvcWcOZVJ7P55YtOH+5zz6LF0jt/ASy5g4je14Sk8tGYdxTgrmpGtff7nL6zmH+VD6FuRunc9Vj5t6DqyzdX8ZUw3imVozjrfJJ7Lm0E/d3Ts7fO8U7VVPRzkxmS+0KnD9e52TDHiYaNWSVyuQVpdRCmaKyhAsr0RaGViH3MvGIQhSLqjK2UwwRWhSERsQMZaoKI0cfiLaoJzN3hXC0JZ/Lj8exqS6FqZUvk180gHHFieyu28xj2umSppP6GIJGiuriWKqOLebxL27qHbXMWv4XSjbP4c7jRu5928i68wZGF6WSvziJ5Sd13P/+HpduXeT98rcpXPsJFuclmr+/zudXPmVq6Wgml47k87pttPzczAH750yrHM1oXQbT1o3glQoVOXMSmbJoNHsvb8f5/S0snkt8vOJ95m2Yjd1t4toDC4U7PiJtVgSp80LImh3FmqNVOL9u4dzdU/ypQlI7la2mVTgEyGt7mWBUK4OFRpnxRaAIJXNpqMILM5VaGaEoUWmVMaRVxZFVFYdappbyINTGAGXGl1FWZfAnTzeAP68dwM76bCzfT+Xz+nTeWtab0Uv6MmKRD5OWDOeYbQffSUSm6YO84kFpGLmLh1F5bKHSZW3tl/h47euMn69m5+X1NP/tGpaOc8zf+QEji9JZerqUmz/f4GzzKT5Y9QavLMhjw+ll3P2+gfr2y+j3zuWdionsMW3D8ct99ts+4zVjAe9tmcxnN1axtX4ZxmPzWXVET829M7j+dovj1/bypmEyczfPwN5ax7XHJhbv/4TsJbGoSkPILopk/dlKWr69y9mm47xVNRHtnCS22ZbT/FMDp27v4ZXKLDLLJPqiUFVGkVEVTubScOUxvSKC9EoBMYrUqhjSZY6uEFFColdKQDDpCin3J6u0J5OW92RjbTK1X7/GkfsFTN86gPzFLzBG58vYIl+W7HiFmlu7+AEHXdINgWgl5EvDyF8Sz5IDH3Pju1q+bNnDe5snkDYjlI/WT+Xk/X3YH13iM/taXl85hiVHZ3Plm/McvLuTt9eORzs3kXfXTOFA41YavrnIHtta5mz8E1sursD2+Aqba5YzuSqPjz97g/23t1D79UnMX5+h8atqrj80cfrufhbt+Ss5hcl8tPktzjcf5ZLzOPN2/YXsohjUpaFoiyNYdnoxprbzHL6zg6nLRqAujGZt3RIsD75kb8M6xlWlKTqiSjp2ZTQZlRFkiNggWmhFFOkVkaRXRpFZKcKE0CCvoKGQ8qowMqoCSTf0YXRlV8rPRnD+wWhOt45i7l4/RuieJ1/XhxEl/Zj+aSwnbxRiv7eF7/92jS4ZhmCyDeFkl4SRWxLD2xtGYzwzj0VHP2Tc6nTSi0IYqU9m+o7XqTy1kNJjM5m6poA3Px1D0enpzD36F8YsT0e9JJoRuhTe3zyJilPzKPtiOh+smcSsrW9TfqKQ6Z+/xWhjBuOMmfx122sYT81hQ7WOzdVVLD2xmPc2vkqBbjiZS6J5ZVU2i4/8leIvpjNtVQHZJTHkSgctjebdTRMpOTqTeYf+wpiqVNTF4by/cxxlxz5m7udvU1ART6YoSlL3KqLJEOFZ6d7/EJmlJnqlQeGIolkKdxSNMphMfX/yjN1ZeMSfU+2jOfd4HKUnAhhV0Y0cw0vklHXjzxuHsrdhPPUdC7DequLbH+roIr9UCKtWmQCiyTHEej+4cRjpypjk9WPUxZHklyZQUJZIrngt+igyRYQwiKoiep6X+Iqqk186jFGlyYwsTiavOJHcsgRFxFDrYtEUR5FXFEVBcQxjDEmM1qWQV5xEVnE06TpJP5kqwpXJJFcnKlSsInGJGJFTNoy8sgTydPJ+nfKWcEN9OPnFcYwoSVAUnUxjsDJfC9HOLPdOMWJrKNxSNNSKcPLKw8mTaxcbpUIE3kBUxsEU6F9kzt4AjrQUcPnriayqTWDi8ufRGl4kW9eN1zf0YEt9BjVtE2hofRfrzSV889MVuoi4qYi2wrs6FY70sjDS9aGklgeRUeWVvjL1wUqd0gi1KBP9LpyMMn8y9IEKiRW1XCXyky4UdUko2cWRaEvE0IogoyyYdH2I96LEICsTKSoCVVkkmcXRZJbEkK6LJM0YTkpFMGkiFhhCydJ1CgsKr4smp1y0yFhFec8wyCgXimpZGJnSLIsjlIgVci3KjUqxIbyekhBzkdfkRiuquTGEPGMEuaK9Kgr5UDL0vRlR2YPCPQEcvTeKK1+9xiZLKpNXvEC+rit5ZS8wZWVP1tfFcqkjl1qXhque17HdXsS3P1fTRWUQkdWrH4rJJBJ/hlF0PuluYV65vyJQ0SXV5cFk68PJKRPZXaR9UdPFihARV5SUMEVF9qaM1zUUWuG1C4KV95e6JPJXpnJiyJKBwBBHRnkUaRVhpFUEKcKBQpCVSUSkK6+mqHRixVSTGie1T2qaaKbhiqArBFokrwwxsyrDlaMI1RUR5FbKOCgeUQiZ0hcUhT8ETZUfmfpe5BqeZ+YeH764lYfl8evsatDy7oZ+5Jd2J7/0RV4tf5FVZ+K46Mqi1p2M1ZnKTc8UbLcX89XfaukioqnXg4lQ5kzxTMRTEf/C65F4wRA3UYATVTu3NJrcMhEEBCwpCzHkGGK8k4JBlHQvL5WblGkMIr0iQImSzPIwxb9JM0YqRV9oiGLXyu8WZbwygIxKP1QVAV4BVmq33BSJqn+SwxRTrFMmU6SyCgkEcSRjvJ1aeV4ajASHgBeBVgyyTgdUxkXv9QxBY+jJmKUvMvegPwfu5lP3eBqHrhXw0adDGat7mYLSlxin60rF4RAu3ddidQ3H7oijvjmZ255p2O+W8OhvJkntEDSiQosxVC5GlYAo6ROHtiyOHPGgOy9IqxemH6mAqDwv/q+IAyLx6+OUuqVW7IlfbVpJvxDFPpAJQ4wyrxEWodRC4XUykomdkFXhT0alD1kVvgqfE2VcbpRW8cEl+n91LX81veR4QfLKZbHKyaqI8bqVMrFUSvRKR/ZqjopPUxGNulJMskGoS7szYfkLFJ8I43BTHtVfTWH/9QJmbPZldEkvxuj6M2LJsxTuGszZO5nUO1NpbImhsSmGxvsp3Ha/ju1OGY9/ttBFkeLFG1FqnESISEcCSKyibueIF6OkaSQ5Om9KC6gickiTyVSiV1xBr9+RJX6HwRvd0jElOoSCyAV5LYhODVC6pKSgUYp8AFkVAWSKqGoMVkY5Ra1R/G5xMuVI0xPgvZOHPHpdwk5zX6JRFgOMsV5Lt3NBQQFasStk7AtBI9ZyyRDydC/yl639WXYxmhPukVz5ahK7rmYzfUcgI4t7MEY3hILFL/HXT/ty6HoKltZkbI4w6ptDaWyOprEplVuuadhvl/LNz2a6SNQok40+xGtnKqB4LU0l4gzeDyTOokShRKXUSklZxfWrDCdN6pWy6eCVqSRyZOshQ6m3Eo3BqPRBaHSBaMuC0OoC0ej9yCofikqO0Qe1AmKIN5Uloo1Sn8Xg987IWiUrJCoFxH/YBaLkeOdq2ajwAqoR40oam5QtmVj0vqh1Q8g1DCGvZAATqwYwZ38QO65ncrZjFBcfjmNHo4oPNg9ihK43uSX9GVHclzeX92WXJYm6tgys7VFYnP7YHME0OmJobEnltnsaDbeK+UEBUtQP+YX6YMXRk4ahNIYKMY7ClBRM6ZwKvPVQoiT0n1y/CNKkwCvREYRW70+2zgeNzgeVfihq3QCydX3IKetJbmkPCsp6MqKsp6Lt5ep7kqPriVbXG42uP2rdYLQ6H7LLfMnS+ZBh8EOlDyRbJ8qUMIKQv5to8pm9JUdMM7nRQsHClWWGbMWLD0CjG0q2fiBaXR8KjH2YtKIfM3f4su5KEkccBVz46hW+bB3Figux/HndIEaW9SJXNxD14peZtrInG6vjueLKxNoaj8UdTp0jEIsrFLsrhnpHCnc807h2q5i//WQSIIWPSbcVYh6idLLMygDSlRNMSlUoSUtDSRU6YYhQgJSGIymiNsiFhZBhCEKl8yGnrD8Fpb0YVdaTcRV9eXXlYN7aOJQPtg9l+i5fZu/xZ+6+QObuC2LWnkA+3hnA+1t9+NPGwUxZO5CJqwfwytJ+jDH2Jr+8NzmGPuTp+pNXOghtyWDUJYPJ0g0mUz8YVdlQssv80JYGkF3qj6bUB03ZELSlg8krHUheaR8K9D2YsLQ3b20cwtxDUaysSeWLuxoudYzg/MOx7LqpZtHhYCYv60F+cW8KyoaQU9KHV6peZtnZUC64MrB6krA6IjE7IjA5wzC5QjE7o7C2JHO79XVu3C7h5x9NdMlSjHBvHVGOdFfZbKgKIb08iPTKMFKWhpOqKESRyoKT0q0V2uOHqlQirjejy3vw+opezNg6mLLDYaw8n8gmSya7rmdz6F4eR5sLON4ykuOO0RxzjuGIYwyHm0dx4F4Bn9/MZuvVDDbaU1ldG0/l+SiKT4RQeCiA2bv9+WSHH+9+OoQ31w3gtTV9mbiyFxOW9WJiVR8mVvRlorE3kyt7M3VZb/60qi/vr+/PrB1DKfkilFUXE9l5LYejjlc40z6RM20jOHBHhfF0DO9sGspYYx/yy/pRoBtMfom830tUnorgTEs6da4EbM5YGhxR2B0RWBwCYjAWZyS2lhRued7g2u0yfvrJTBeV2KRKNxOZXeiKpHSIF1SxTmV8UvzjCMWdE0VZK9NA2WCyy3oyuuIl3tncn5JjIWw2JXP0bi4XWsdy5eEELj2awIUH4znbPpZTrlGcaB7J8ebRHG8ZwwnnWE66x3C6bQxnOkZz7sFozj0cxbkHIzjbUcDptgJOego45sjn8L1c9t7UsPNqFlvq01lvSWFNzXBWXx7OqgtJrD6fyPpLw9lck8Iuawb7r6o40VTAOc9YzreN51zrKxy7P5IdtkyMp8J4f0s/JlT1J6e4P9rSoeTrfcgp7sGkqhcxfhnMqaZ0bO2pWFqiqJd6KEC2hGJ3BGNzBGF3eIG86XmDxjtl/PA3M11kyhDe51U/vIa6UBXxcZRuqYijkr4it8lz/mSX9mFMRQ/e3zqQygtR7LmTyen2Ai59NVZJmSOOfHZczWTVlQT0J6NYfDiMwr2hzPk8hFk7g5i5SyItkHn7gll0KJTS45FUno1lxaV4NtQNZ6s9nd03NBy8l8cRiWTHSE66R3OqbRynO8ZzquMVTrW/wun2id7TNkE5Z9sncLp1PCc945So33snn03mLKrOJDB/dzB/XjeAcZW9ySntQ57en1xdEPk6fwrK+vLqshcoPxXAGVc65gfJmF2SvmFcdUVT3xKGrSWQBpeAGIitJQJbsxfIhtulfC88UlsmdU/ETu8WgrKloPgWkYqCrJj6spVWEYBKN1hpDm+u70f56Wj23dZw4eFoLn01iuPubDbXJ1B6KpiPdw/hjY19mbiiF2MrezGqvA8jDf0ZYRhIgaEfBYY+FBh6M9Igz/dmtLEP4yv7MWlpf15b3p/XV/Xnz+sH8sHmwUzfMZR5e/0pOhxC2fFwKk7HsOxCPKuvDGdtTQpr61JZW5fCqprhrLiSiPF8HEXHI5i5N5D3tvkwbc0gJlT1Y7S+L3ml/dGU+aA2SFMMJl/ALOrJtOU9WX05ki8dSdQ9iMfcFk5tcxA2RyiNrnAlEu3OQOzOAAVIJSI7gay/XcJ3P9UJkJ3Tg7KD4+WH0nwk3ZU9H+mARl80ul6MqniRmbt92GpP5nz7GGoeT+RESz7raxKZu8+fqWv7MrKyN1pjP1T6/grp1RgGKyfbMBS1QejOYEUcUBmHKNRHXe6r1Fq1ThqGREkAeTp/8sp8yC8dxIiyAYzS92eMoR9jDX0Yr+/NJGNfJlf1Y/JSiaQ+vLpCOnJvXlnWi9GVPSgw9iLP0IdcQ3+0usFoSqUxBZArfFIfQk6laAZ9ySvpxgef9mdLXTyX2zMxdQyjzh2M2RWIuUXAC8fWEtQZjSHKo90RRL1DIjKZm57X/wGk7NgoU4My2nkfRYBQ0liOwR9VaQ/GL3uRsi9Fcs+h5uvxXOgYwzZzCvN3+zJ1WS8KynqRXTYIlT5A2Z3xigUyUYikFYimc+sss9KX9Eo/0iv8lH0ib02WqUrWUqJQ6WUZK8a7uVsWgaYslGzZBJPuXOJPbrEfI0r8KCj1Ibd4EDkl/ckpG0CO0Bz9IFRlA9HofZQSpBbqpFgL3msTVqIqHYK2rBevrnyZBQeGsu/qcGpaM6lzRWN1h2J1BWF1SjSG0eCOwNrij6XZjwZnKPbmYAVIaTy2Fi+QDbdL+F6AlAUhb9cWfugl3t41j1C0xgA0pT15bXUvll+O5UybjFFjOXgvl5Jj4Uxb1ZsR+p4K99Ia/BRJyhvdkZ2zt9dXVomKZBhKmmEAGQahL75k6P3I0IlgEIBKllmVbPDO/N4t3k5uKA1PNuKEbinLVWHkyNGHkK0LQqOXZVjvkUEhS57r1Bm1hjDyjKHkyM8FwJK+jDf25ONtA1h9KZRTLSnUeYZjccXQ4I7E2iQRF4q1ORhLcwj1rjDsTn+sLT40OoKpb+6skQ6J1OHcEEL+K5DpygQiM6t311HGOOne2VUBqEt6MGV1b1bXJCi18MqjEexsTGbGzqGMNr6MprQPKr2PQpJFock2BqLV+yppmbtkKNmLB6MtFpI9kGxDb7LLXybX0Jt8fT/ydf3I0/Ulp6wP2tJeaErk9EalnL5klfQnq3QgWWVDFI6q1vspoGXrRYGSCUhGSTGpgpSapyhTncZWjiGUHEnl0iHklvQlZ8lLjKvoyfubB7H0VDhHb6VxxZOKuTWeek809Y4wGh0R2JvCvFSnOQJLs3RoSW8/7C2+XHWGUC/p7gjoTHkvkPW3ir1ADpeOLOkl6Sz8UFFHZPusN1NW92J9bRLVj8cpZ4Mpgb9s7MWIsm5oy/oqBpEoKekif+l9SC/tiabkecaUd1Umg/c3DmbGDn/m7Q1ROnfJ8TD0JyIwHI9Afyyc0iMhLD7oz9zPB/Hx9j68v7kXf97Qg9fXvMzk5S8yvuJFRpe/zCi9TEO9yCvpQ07JADQlA1AV9/eekv6oS/qjKR6AtmQguSUDKCjpx8iSHrxieIl31vVm3u7BLD8fzr7rSVxxp2PxJFHflojVEUW9M4oGRzSNzmFcdSZwQ37mjKbeFY5VaqIzWKmT9Y5Q6h0hStOpd0VgdyT/TyDTlDXgULL0geTIspAhAFV5fyat6ceq6gRqH79CzcNRrLscw7TVvcgre4k8RY73Qy1AGnzJKh9EblUfpm3qx5xDQ6k8F8RmczT7ryVzXKhRk4bzTi0X3dlcdmu44lZz2aPiojuTc440TjUlc/xuIl/cTmDf9Xh21cex2RTDmouRVJ6MoOxIGIv3BVO4O5hPPgvkva3+vL1xCG+uH8jrawfwxrqBvL1uEH9eP5gPPvVh7q4g71BwJpJdtgRO3E3hojsFc0cyZncU9e5o7M5Y6p0JXGtLVUBpcGZguptEzc1ozPejFCAtzf5Kelsl3R1hShe3CQX6JyDtt4q9zUbR9qS2iP1oDEBb0pPxVd2pOBtN7devcuXhONZdjmXaypfJLumrzNK55QFKN9SW9Wbc0l58sHMIVZei2HUzieOOZK50pGF5mEb9g1TqO5KpbxuOvT0Je0ci9vZ47G3x2NuHKcfWMQzbg3jsDxKwPUzC8mA45o4U6tpTqW5L55I7k/POTM42Z3G6WcUX99LZfzuZ3dcT2HV1GJ81xrGzYRifNySypzGJg9dTOHkvi/MtWVxypmNqTcXWnoTFE43JGYrVHc7VB4nUtSRy4WY8XzbEsetcAJ+dDOLTgwPYcrgn5+qDuOqJUOiOzRXinWgc4VgkSt3BCpDWluFc/2cgM3QhZOqD0Br9yC7uyThDN3THAjnrGUndV6+wsXYY01a/SPaS7mjL/Mgu80dT0p8xFX345DM/1lwexoGbSZxzp2B6mIypPQ6zJxK7J5wGdxiN7lCuukNp9IRS7w7BrnyQYO+jHE8I9lY5odhbw7C3hWNvi8TWFoWlNRpLawwmTwx1nljqPMOoa4+nVmjKg2GYHiZ4z4NETB1JmDuGU9eaiNmTgMkdpzQRqysSuyuMelcI9e4I6tsTOH0jgh3nfVi2ry/6z/qweOPLLFrTg/nLnqVkzR84YQ7gRkc0DR5/bG4RKoK8M7Y7DIs7CKtEq2M410TY/RVIVUkwWtEARcQs68o8ETGdeZgejWOHNZk/re+BprQr6uKeaBf3IXdhd95Z358V52M5fCudy+4MLO3DMbujqXWEUOcIwuIMwtoSgK3Fj/oWfxpbAmmUjnc/EGtTAFaHnECsTu+xiKriCMDsCPD+W3icMxCTM0B5NLuClAuwuIOxeEIwKycUiydMeTS5QzC7vd8LhbG4QrAK73NJTfNSlnppFu4Yzt0axoqDfVmwoSuzVnZj9urezF0zgPmrBzJv+cuUb36Bc1ejuPYgGptniPe0+WD2+FPnCsDsDlAiU4C86p6K7XYx3/1NeGRpqEINNIu78tetAzh4S4P50ViO3lbz3oaeZC95iqzSF9EseYGJupco3hPE3vrkTu9iOCZRQhwhnYU5SLnzUpwtTf5Y7vtgu+9LfVMAjc3BNDaHKp3P6vByNasz+H858rwXYIkGmzsImycIe2sgNk/ncQd6+Z7C+bw3wSJpqESPH1aXP3Z3AFaXH5YWP+VzNbjDsTmHset8IAvWvcDM5d1ZsGEQhet9mbPGh8J1Psxa9iKrDwzg8r0EGtqjMLsGY3ENwN46GKvHF7PbXzkiqZkdw2l0T8V6awnfCpDqJcFKpL21qg/bzSlYvn2Vo/dzmLG9P7lLnkNb9jLq4ueYXNWdNScjOXsrE0trJmZXPGZnpBfEJn9s9/1obAqk4X4QtvtBCieTqFQiT44Q2yZ/rM0BWJslYv/5yM+DFIDNLd4I/RVYi0tOkHLMEhGuXy8mUKlXNndw52MQ9a0Stb5YPD5YW32xevyU19s8UkLCqW2KYe2B/sxd9jwLVvdmySZf5q/zY+6aocxb34+5a55jy9mhVDsSsHiilN9hcQ7F5vbB5pIbFeL9DP8bkKpFg5mg68m6CynUPXqV064RLDocQEHpU6iWdEOz5HmmrXyBjZdjqXWqqXelYHPEYHWEK2OUgFTfIhEXyNX7XiDrmyVCQzA7gjE7g5T0VNRlRWGWlBdiKykXTL3yKJPE/wTS5gpW0lPS1OQMxiRp3RqCtTUYq+cfqW52BynHKvW1PZKGR9FY28OxtIVhUx47S4A7giv3Y6nY9iILVnRn7YFIqj4PY/66wRSu68+s1c9TvO15jl0Lx/YgGZM7WqmJVskKl8zYwinl8wQq72V2JCupbb1VxLfiIuYt6o7xcARXWqVDT1Z43gj9s2QVPYO25DneXPMym6qjqPVkUt+WgLU5BFuTzJ8hWJwhWOU0B9DQEqSwf1uzABGsXHyd8tj5Gkkxh69CcCXdbIqKEohNKIYAeD8Ai5QEqZUtvt40dQcp9a/WE0JNaxC1SsQFUe8Jo94Zht0disnlT50nkGpnBEfq/Thk8efLa1Gcvh5NdXMC1rZEbG3x2FoTuXArDuPWF1h3IIRdp1MoWjeAwrW9mb2qK/PXP8Xu6gBqHHFY3N4mV+cKx+QJwerxXpdco1myzBOFzZnKVecUzDcW8t3PtXSZs9Of846x1D14lXWXk5lQ8TyZi55BXfQ0U1Z1Y31NFKYONRbPMMwt3sG9wRmMuTmQWhmlhFJIajb7K2RVUs0iF+gO8zaflhAl/e3ScBz+1CtA+mJr8fcC2RKoNAKrgN4coMy1yjThlmbjT43DnxpnAHWtgZjbg5Q0ljLQIATZJU3GD3N7CFcc0aw/1pPizc9RuuUllu3uy/rDA9l+ZjDnbsdha83i9NU4Np/w41BtGqv2hDJ36YvMWv4Updu6sftKEDXCJ9sSsbgiMbmjqHVHUOOWbJAMCqDRJeVDojQKS/NwrjlfU3zt736pocuBmznUPZjIbnsmb6/pjXbBU+Qtfo5py19g1YVALramYmpPoE6R26WxSMcKxOwIos4haSfdUSLUD2uzr1IXzc2S1hHUyWkJU763ycDfJGVAItBfmVmtLcGY7gdTd1+6bJjSZSVSvT8LwuYMpt4dSGNbIA2tEul+2FuDlccGt5BlPy+QraHYWpPYfTGAwtVdmbPyZRau6cmitS+xcF13Kj7vyyFTDLVOLccaEzlgSmTRmt4ULn+Jip0vc9gSitmVhs2VTL0nEasrFktrLOa2aKo9YdQoZUSamB91Ln9MwicdSdzwvIb11gK+/ukyXWq/mcyxeyP4aGMvshf+kexFTzPZ0I3VZyO45BEQY5U7Y22No645mrrmCExCcdze2lXb4o/Z4YvN6YvdIVEmI5XI8gK8gB6GRYlkGbHClUhqcHiBlQiX15jkdc6wvzcYuzNUIcFWVyg2tz82l48SyfWuACxuoSG+1Ht8sbuHYvH4Kelvc8VxtiEO/fb+FK4dwPxV/Zi/qi8L1g+icE1vdFt7cdA0DFP7CD49E8CMymdYsSeA040pNLRpsTozMTWlcvFGLOeuR3Hyagjn70dQ44mktjUES1sAplZfzG1BWFqjsDgSueqciOVGId/+fIUuR1rymP2ZLyOKnyV9wR8YW9GV8qNBymRgfzgca2sEdcLkPcOwe5KwtSZg9kRglkLvlLvk6+1sLj+FdIuKIrOqV2qSwV+GfJkQQrG7RWWJo8Edi90dhc0Tga0tUpk2FP1PiLMnHFtrONb2CCwPIjA9CKOuNRizJxCLJwBTeyDmjgAsQkdcQzB5fLC1BXJVumxTEptPBjNn9cssWNOPRWuHMHetD3PWDGbm0u6sPODL6btqlh/uR9HGbpy9lou5eSR7z0WwYf8Qln/Wl8odPTFsewHD1q7svuxHrTsWU1sIdW1+1Lb5ccUTQK07UgHyhudV7LcX8K1EpP5UGAWLniSv6Hlyi5+g8IAv55w5WDtU1LmHYW5NwNKewaWWVM7eG84ll4xuSZjbY5TuaXUHYPOEYpUJxJ1InXM4VncKDa0JymxqafFXphezJ4ZqVxLV7gyqXSquuDO44hlOXXsC1o54rK5oxea0tiVwxZPAxfYkzncM5+KjNC49SKambRjm9mhq20O9FyOT0MMozO2B1CkRG8xVdwJnbg6nYu9A5izvxvxVfVi8KYCircEUfTqEhet7sPHLYJYf7M+mL/25eDuXTV8EsWT1iyxZ1YdFq/qwcG1v5qzoyuK13fjCFE3Dg2Tq3EHUtAVS0x5M3cMYatviFfpzwzOZ+tsL+ebHy3QZo3uaUUuep6DwDxTuGsSxOyrMrWrqXGnUtGrYYx1G2f6hzNzSmw82vMhfN3ej5FAvDjTIlBGLrTWOWlcyeyxRlO4byKKdvVlzyo/Td+KxCJgeASeeQ1fD0B/tx5zd/Zi5ayizPvdh0X4fVp0N4OjNOCxt6dQ5k9l62Z9F+3ozd/8gpu8dwvRdA5mx7WUqD/fm2NUwqj3RVLdFUd2aTLU7mbr2aMytQV4rwBFOrTOJE9fiqdrZkwWrnqNw3Uss3NSPij1BlG0dhHHHIFbt9+WQSaI3iDlLn2HByp7MXzWE+Wv8mLd+ENNXdEO35WXOXE2gsS0ekyg+j+O47I7icmsS1Z406lrSaHRMwnZjAT/8UksXzcKn0c7/PR+s7cGBhmSsHTmY3KlUuzJZeyaYNyueZNS8/yK/8D8pKPpPchf8G6/qfsf6MwOwuBOwt6Vx7n4Wuv3+jFr4B3Ln/Rcfrn+BvQ3DqG1NUSK61jOcjZf8eK3qD+Qs/h35pc+QW/Ss8nvHFv83C3f15PiNZC61aCjdP4gRRb9FvfAJVAufRF34O1TT/533qn7HIVsolgdJVLfGs7U6kIXbnmX9mR5cag6loT0ai9Radxy29nQu3Ihn+8khGHa+yNy1z7Bw40usOhRK+ZYhLNvpy2fnYina9CKL1vfCuDOUBesCKVwfyOz1A5mxqivL9vSm7n4y19pilJG3xh3HxrO9WbjtCXbVSufO4Xb721ivL+S7H2Wtb/ELTKx6hm22RMyPcrns9CK+vTacaeV/IG/2vzOt9EkKt/Wh6uRQKo73pXRPN3ZdGoTVEUdjWxZf1Kfw8bo+jF7clZFFzzHZ+DSrzwYo72PyJFDrEiCDeK3yCSYa/siCfUEYTifz1x0BjC55mollf2TDhWGcbxmL/lAoY4qe5I0VYvEmUXE6looTPmy5NJhzd8OxtA/jins4xbv7kDv9P5mz8TnO3kvG3JqCVeq3MxazWKjSfZ1Jymy99cxQlmzpSvGmHhg2D8a4xQfd1sEYPvNl5eFYFm32Y94GX+asG8zs9T2Zt+E5dl8SppDilc1aw7nYkszHq36L5v3fYDwwGJNzBNc9f8J+U/TIWrrkFnVjxcUozrdlcVnGvo5kzjlSWLy7N9mz/4PJ+hdYfTKOC858rnRkUtOezBVnIrUtsdhdEvYZbLoQxTRjV15fMZj3NgczwfAMC3f34cv7yZg70jG3ZbDpchhTq57k7RVd2VGfy7mv3mdTw1imLO/F6KInqDoWzqn7oyk5GELBgt/z0eYgDjW9xYVHf+Lig7HUdGRS2xqHtTWWGncqCz8fiHbWf/Lh6u6cuKXG9ng01o4sBcgGUb1dYZiaQqhvTcTiSefE1QSW7unH4jU9WLymP8WbfFh+MA7drlDmrB3ArDV9mbHqReZteJ5lB3tx4VY8Fmc89tYIGh4lcrZFxQcrniLzvS6UHwimzjmW6553qL9Zyg9ixxbvC6e6LZ9adwImVySW9gQOX43h3eXPkDPnWWZtj+T4nQKsj/Kp9sRT64nE2hqJRTqXJ4GzTWks2T+YcaVPMO9ALMbzal6t6s6f1z3PjoZhXO5QcaUtkw2Xw5la9TRTl3ZlvVnLsbZ3WFmTw+TK7ryq+z2bL0dyxqGh+KgP+WVPML6yD5/sHMbc3TEU7vJh2YkBfHlLZLZETO4Mivb5kzX7v/lwfS+O3MlnT30yBxpiqHFIKoqoIU0uSAG1tjkaW5uK0zfS0G/rS+Hq3hg/j6ByfywzV/Zm+vKXmLfuRRZufI51x/py4V4idk86ZmciV5qjOH03VhmdP1zfg8wPu2A4GEWtcyLX3H/BfqNzQeDMvTysrWkKlzO7wrC0JSgf6E3jUxTMf4ElBxK44MpXBvk6Z5QiIlid/soeTI0nhT2Niby7oTtTlnVlbV0OO29O4oPNQ5lkfJKl58K50J5H7YNcPq2OZkrVc4zXP8e7m334cHswr1b1YHzZk8zZ3otjt5M570qn6IuBjDI+TW5xV9Rzn0E943dkffgfvFX+b+y3+dPQloStTc2CvX5kzfs9H3zaly/uj2Lu9j4U7e7B2fvR2NojsLYFUdPso8z7Nlc0DR1p1Dqy2H4ugtkrX0D3WSCLNg1m1qpuLNnyEhuOD+F4o4yFw7G0CvtIxNqeSeX+59Dvf5njzrG8t64naR92QX84jhrXRK55/glIswKi8ETpeGFYOlI40BjLm5VPMGLB0xQfDOeKJ1OZPxtckTS0BFMvY2JbIjUduay6GMk4/e95c+ULbLfncfjeFBbti+aVkqeZt2soJ5vyMXeMZtPlOKYt7UrOoj+iWfQsqgXPo134LO9tGsDn17IUsC+5MllyaDAFxX9gctWLFH4eRNnBUKUBrT7Vj5O3w6gXwdadQeEeX9Ln/Y6Ptg9k7x3vQPF6xe/Yfy2auodJCpGuFoLf6lW2a5ojaOjI4rA9joWburH4097MX9edTacGcepmFHUuKQHDqH8QS7WMrI9SOedK489V/8mcbb051DSOT7YNIuXDLpR9EUeN5xWut0lql/HDTxa6KKsZMrM6RK6KwtyazNGbw3hvzR/RFv4nn2zrz4k7KVz7Sk2DK4FGZyw3hEd6Mjh6T83CQwGMKH2CcWVP8sGaHny8fgCvV/Zi9KJneH/dAPbY1NS4x/Lp5XimLevGhKqXmHs4iRl74xlV1p2py7uz2ZqC6dFoLrm0FB3wJ3fh7/lw4yCON02i7qvXsX4zAfNX2QqXrHfHYnGls2h/IEkzf8tfNvdn371xzN4ZQP68/6Jo3wDOuNXUPsxU+F6dTCGt4ZglSDzDOHN3GMXbn6FwzVN8di5I2fGxd4iqH0VNSyg1jlBq24Zh+iaXZWd8UU3/DYsOhHKy9U3eXvEiwz/sQskX0VzxjOFq65vYbxTzw49muthcMZjFz3WGYL4fgl26bFsqZV/0QbPgN4ws+SPlR8I50zyKK+48qlsyuXg3lQuOXHZez+btTX1RFz3BqNKnGb/494xZ8HtGFz3PmOIXmFbZhzWnE7nseoVP61J4dflzTF7elc0N+ey5O4EPtgxg1JL/YvbO/px2jOSCeyzz94WSW/Qcf90UwBc3J3DRM4FzLg1nPQlc6YjB3hqNvTWLxQeCySh8klG659l2bTylx1IZUfg0eXN+j+6LaI7d1VD3UENNWxzVommKatQWxelboRh3P8nKvS9QczdFaUYivtjkfWU4aMvE/Gg0G2uSGFP8W1SFv2G1Scvn18YzqfhpUj/uQslRUctGcLV1KvbrRZ1AOqOxNAcpik5Dc6gyJ8t0cehGDO9seA7N3N8wasH/46MN/Sg55M+S3X1YsPl51pwJU3ZwXql6hleWdUN/ahgbq1P5tCadpWeTeWdtX0Yv+j0LPxvCl3dHsq46kYmVTzKl6kk21CRyum0iqy/HMVH3Rybrf8/m6jjOuMZRdDiagqKuvGboxayNPizeMZB5W56h/MhzHL7ppxB8iysN3ZFQsoueI33uH1h8NJ1dN97mjaqhZP31KbKn/5GPN/Rjc80wzroysHyVgbUtBqs7kkst0VTu+X/sPNuXxtZ0rO4Y7O1xNDxKp86j4dgNNeWHw5hQ1o34937D1DX9ONL2PsUHk8if+Ts0M/6N8hOR1LaP4Gr7VOpvFfHT3yx0sYm71hxAvdgESv0LUWZekyeJPbZYpRGMLvpvsub+OxmF/4Fqzm+YXPoExqP+zN3Vj/Gl/8asz3py3JGD5bsx1H2Vz6X2XCqODWTswi68t7Ibexoz2VAdxzTjH3ir4ndsuhzBxdZRHL2rZu62F5i4pAuFn3Vn3800Zadx5KKnyJ35BHnTf0/2h/9O5ru/4bWy37DLKlpgAlcfqllzKYbc4qdImfcM+aV9qDo3ipXnRvGarKxMf5bMT54lf8HzzNnlw56rqZg6tDQ8UnP2bgxVe//AYdNgbG2SLeHUPUrm1L0slh+L4I3K3qhmP8Pwj/6AduGLrLdPZp15EqMW9UA742lGzf4tG87GU9c2AnurV0b76WcTXURbMzV7l4PszZ1gOoIVYcHiTufLW2msvxTN4kP+zNrnw8KDQ1lzLoS9DUmsuxBC1bEB7LKGccE1nGpXHJdbIrjiiOKLxkBWfdmLlV8OYH9jAvsb4ln75QDWHe/L0YZoaj1qamUENYVgPNCN1ad6cvh2HNtMcRiPhGI4GEn5wSjKD4Sj2zuUFV8O4NgtYRZxNDzI4PPGRCYte57Mhd1ImtGdEYv7UnYkj9LDeUwyBJI5ewBZ8/qTOuOPTK3qzvpzMZjaR3GkUYB8kiM2H6/j+K2aXQ0x/HVtT3Km/5H0GS+QOU8WrAZReCSXqisTGW8YQuaMl8iZ/QKTFz/FAUsGda351LdNwXJ7ET+I1WB1RinE1docirVJzKlwGlvCaWiO8C5Ztg6nsUOFrUNNrSeDGlcqltZ0LK0ZSMeX5mTxiOgQhd0p9quccOo9UYp/7aUSMnEkYncn0eBJwC7lpClS+XuVa+2pNMhfDHhkZo+k1pWAqTUTU5uKulYVlnY1lrZUbA/iFAvB5Aqh1j2Mc60q5u8fRFbh06gWDCRtZn+0hb68sSqRt9elkFsSRsq8IaTO60Xy9D8yoehZNl9M5tRNFRtP9OHEtVBMj7PZdT2dN1a+TOZHz6L6pD9ZcwaTMW8Ak9dG8t7nKcpmR/zH3dAsHEzGJ88xc30/LjQVUO1S09A+FcvNRXwvO+SWlrDrluYwrC2hSq20i5rdHMo1ZySNogneC8R2L0TZjbnqFD0xQpHJTE3hWJ0R2IWgKwp4MPUi3N7zo0GsB/FgRAFXbFGxBiKU/1boU6MjiGuuUOVPLexNEdibI2mQ7QW32Bfib0crpF/xTOT9PULExVv2weQKxNQajelxmrIY8Ir+eVJmdEO9IIC0OQGkzR6CepE/6uIw0hYFkb7Yn+GzeqCZ041puhc4YM3i3J10ajwZnHVl8+G2gaTOfA71HB+088JJn+VLbkkwOWU+JM15iWGzXka1ZCipc3qQOfP3bDgXg/XBCGqcGVztmOY1v360XO9ibQm9KJtXNqf40UOxuIZiavZX/JMGZ4iyPHS1RYytAG40B3PDGa7sB1qdYdQ2ByjCrrhrsgIn0Wy7H0ZDS4Sy8mFq8cfkEOFXFG8Rc2XDS/xl2Z8Jxt4Shr1FlpZisMjiUksoJhF7nWLGi/Tm9WxMrjDqxHjyeJ+vET+oI5LaxxkYjwcyYtFzqOYNIKMwgJR5PiTP9yFpfgDxc/1IXhTE8MIhpM/tRfbsJ1myYzDmtrHYHo9guyWeESXdGD6rN6r5QaTPDiR9rh8pcwcr0Zy20BdVSRBpC/sRP/2/+Whrb860ZGKVcdWZQmPrFOrvGvjh5/qLXWzOCJ0XSLE3B2N2D8IqRlOLP7XNfoqZb3f4Ybs3FPtdH+rvByr71DbFUQvA5PCjrsUPs1CI5kjsMo41R2Jq8tqo4kPXtfgqDU0xzJT3HYypxafT6/EyBckKAdK78N7pFraKQyhynfxFgQwNMZgcYYpjWCcib0c051xZLNg1lMzpT6Aq7E/6gsGkLvIjqTCA5EVhDF8QTPICf1IKB6Ca15W3jM9x4kY2pgcjWXYyCM387iTOGsjw2T5oisJJL/QjvdCXtEI/Mhb6kzi7L/GfPMWry55n/90MLI/TqZGMdKZhvj+Z2661/PTL9bIu11xJOdamMKzScNy+mJyDqXX6USfmU1sQtbJh4PbF7PTHotimodQ7QzE1+WFx+WKVnzkEcDGlIjA3yQnH3CyOoD9mp49i2jdI2jYHYRLQ3T5YPEMxOwZjaRnqXZWTDYtm8XvEupWbJD52EHVitLkiMLVEKaqOqTkCc4sIycHUiNn2MJmLTjX6Q4HkFz5JysyupBYOJmluAKnzwxk+J4iUQj+SFwwkfX53Jhu6sq9ejenBGCoO+6Ge2530Qh/S5g8lZe4gMgr9UC8IJG3OIFTz+5My4xleX9mHvdezuNSajrkjimphNp4cLl2dgufxXn7ivrbLSeL/w3ov+ob1fiD1Dq/DJxdR6wziisOfapdI60GKLWmRWVzxX4IVuiQgmFuGKLO3+NFmqbUOqZkRSsRanQFYxY4QoBVmEKp4MianLxa3D1bXEGzOIdgETDHFZKST3W1XKBbxbkR5l+OOwOKMxuaKVUZEszRG8WnaBOhALO3xVHs0rDodwZiS58mY9zKpc4aQNjeYrAXhpMzxJW3REIbP68ao4mfZfTWP6rbRGA/5kTXzedLmDiFz8VBSCgeiXhhE5pwhZM58iYxP/sD7Gwew/3YO1W0a6h8mU6csK8Rx68FUzln+wlc/nr8BeP//u9daUqfY7wdjvevTuVAZgbVZalyo15hS3MNIZcvfJg2iWbZXA6kX/ilWgrLnI81FXEBZf5Mj/5bm9Ss/DcXeIu6bgCKNKlhZGKh3+NLQ4qs0qPqmYKXRKX+KIe5k5/qKLAvYnGHYnBHY3GK+iWfu3cORbQqTrKa0RmJ9pGFnfTpvrx5IxsyXyJrrS8Zsf9Lm+JEqKT+/B6P0L7G9MZ/LHWNZeiwQ9cznyCgcStrCQaQtHIxmYSAZ03uTN/uPLP58KKccWsyPNVS3RGNzR2EWRuPO5lLDVOy3qvjxl+tv/v1/eyhfV1uGnWxsDsN+L4h66cj3wzE3STpK2kdia4rsdAHDFL5pk7GyKQC7+NlimreIwS/m/j+OEoViajV7mYBNqYORmFrEYZR/S430xd4k+0GB1It+KPtBDmlKsq3mlcNs4gtJJEg0uwKpdQUoPopJWa6SDBqC1eODuS0S8+Nc9lzT8vbKoahm90Y9zx/VghBS5w5m+OyXKSh7iS2NI7j0YBwVR/zJnP6sEpGpC4eSMn8Q6bMHkvVJV3T7wqhtH4XtUaZCy8xO2ZeMwtqcyp32t7homYHnwanqv0fjr1+NjoKQRtewU5amACzKJkUwDa5QpXMLaJa7/tjuCXCB3sYkkaL4JGLwS9TITo5vJ0XxwSxRIqmtRKp40UGKMGJyhmNyRmIWb1iJus73cITQICvFskskXd7lrywuWT1DFZBsHnEOA6h2D6Wm1Q9TqywheHmlVTxvj9dzFk/H9s1oNlRnkD+/O5lzBpIxLxDVgiDSZvdhlK4X266O5NKjcVQcCyBzVlfSCgNIWxxE+iJfUqb35KP1IXx5S8vVhyoFQHE1Rdypa0rhumcqNQ0f4Go/cPnHX1pi/geIv35dbR092OZMbLK74rxUpEkM/6GKp9zoCqRB9l+UtRJ/ZZdHOrqtRRqFd/NLmojJM1SxSJWtMAFYAUb4oTQNb/MQKiMAyHNWh7yPLLx7G5lEtaWzhpo9QzB7hEX8ug3mS03rEGrb/TC1hVLnFqs4TFkQsLQGYJLXtAZT25bAyZZc3lsrJL03GVLzpHnM7cWYspfYfjWPK1+NxnhsKJkznyFl9mBSC31JndsfzbyXWXdRQ/2jkVid0UoQSFmrvj+cGw9e52rzHK7dXeX8kVux/4rf//iyuyd0t7g0J62uRGzy5xJuX2xyMe6h3pU7ZbFJIlB2DoMVcOXUi7fhCexcvwug3h3UGdGy5ClGfwiW1iCsnat5ymvdAcq2hKyoKLtAUjdl68vji03ZJpOtMtlRHKxshEkam1qHUtvmi8kjXnckJk8UdZ5wTK1BmFr9qH8YTI07lOoOFaWHhqKe+f/QzHmJrJndUc96kon6Z9jZmMHlR9mUH+mDdu4TZM8fgGb+IFKnd2OCrgc7LBnUP8pQssjSFMb1Vg3XO97C0jSLW83rq3/55frL/4rb//p1ve1Pf7zeOumNBpfmvN2VqKyq1DUL/UhURj2zIw5ri/zvCOKpb4qn/n489uZ4bC3xWB3DsDnjqXck0tCcRH1zIvaWBCyOYZhdsVjdcdhdw7A54rC1xGJricbeEoOtOR5rcwKWlliluVmcMQrdsTijsLuisDmiscoRzdQVjdmZgNUlf+o2nFqnqPeiDcRQ2xKmLE6ZH+RScciP/Om/I2f68+TN6Yr6k9/xWukz7LGrFf2z6otB5Ez/HRkfPo/6kxdQ//Vp3jT24YsbI7G151LvSudu+3hsd17DfHvulZZHe955/LjmuX/F6//8unNnzm+v3n9be9P551W32/984/bDP39169Eb3Hk8jXsPp9LUMY2Wjjdo6XiT+x1vcqf9DW61v87tjje42/4G99re4G7bNG63TeFG+2SudUzmettr3PBM5aZ7Grc8r3O3fRr3H7zOvY63udP+J253vMntB29w68Gb3FL+PY07Ha9xt2MKd9omc6/tVe54JnGzdTI321/jetskrrWN52b7BO48fJUb7a9w4+Fkrj18m5ONr/L5pSlsOjONTZffYOOlyXx2ZSJ1ro+4/ug9TjWOZ8u5SeyofpdtF19n09lX2FU3lSvO6Vxt++Qr250PbthvzPu0xbVRCyd/+6/4/PPX/wfNO8LZMR4qIgAAAABJRU5ErkJggg==`;

  // ── Shared header / footer ────────────────────────────────────────────────
  const hdrHTML = `
  <div class="page-hdr">
    <div class="hdr-inner">
      <div class="hdr-logo-cell">
        <img src="${LOGO_B64}" class="logo-img" alt="">
      </div>
      <div class="hdr-text-cell">
        <div class="hdr-name">Krishi Care &amp; Management Services Private Limited</div>
        <div class="hdr-addr">
          <strong>Regd. &amp; Head Office:</strong> 617, 6th Floor, Hubtown Viva, Western Express Highway,<br>
          Shankarwadi, Jogeshwari (East), Mumbai - 400060.
        </div>
        <div class="hdr-email">Email: administrator@krishicare.in, Website: http://www.krishicare.com, Tel. - +91 22 68284109</div>
      </div>
    </div>
    <div class="hdr-rule"></div>
  </div>`;

  const ftrHTML = `
  <div class="page-ftr">
    <div class="ftr-rule"></div>
    <p class="ftr-corp"><strong>Corporate Office:</strong> ${COMPANY.corpAddr}. Tel: 011-41039506.</p>
    <p class="ftr-cin"><strong>CIN: ${COMPANY.cin}</strong></p>
  </div>`;

  // ── PAGE 1 ─────────────────────────────────────────────────────────────────
  const mainLetter = `
<div class="page">
  ${hdrHTML}
  <div class="page-body">
    <p class="date-line"><strong>${formatDate(ol.offer_date || new Date())}</strong></p>

    <p class="cand-name">${ol.candidate_name}</p>
    ${ol.candidate_address ? `<p class="cand-addr">${ol.candidate_address.replace(/\n/g,'<br>')}</p>` : ''}
    <div class="cand-meta">
      ${ol.employee_code ? `<p>Employee Code &ndash; ${ol.employee_code}</p>` : ''}
      ${ol.candidate_mobile ? `<p>Mob &ndash; ${ol.candidate_mobile}</p>` : ''}
      ${ol.candidate_email  ? `<p>Email &ndash; <u><span class="elink">${ol.candidate_email}</span></u></p>` : ''}
    </div>

    <p class="salut">Dear ${ol.candidate_name.split(' ').filter(w=>!['Mr.','Ms.','Mrs.','Dr.'].includes(w))[0] || ol.candidate_name},</p>

    <p class="subj-line">Sub: Letter of offer/Appointment for the position of &ldquo;${ol.designation}&rdquo;</p>

    <p class="para">In reference to our discussions, we are pleased to offer you the position of <strong>&ldquo;${ol.designation}&rdquo;</strong> in Krishi Care &amp; Management Services Private Limited to be based at our <strong>${ol.location||'Mumbai'} Office</strong>${ol.joining_date ? ` as from <strong>${joiningDateHTML(ol.joining_date)}</strong>` : ''}.</p>

    <p class="para">The offer letter is valid for <strong>${ol.offer_valid_days||7} days</strong> by which time we must be informed of your decision; the said offer letter shall stand cancelled after the above-mentioned date.</p>

    <p class="para">We are pleased to issue this letter of offer on the following terms &amp; conditions:</p>

    <p class="sec-hd">EMOLUMENTS:</p>
    <p class="para">Your compensation on a cost to company basis will be <strong>Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- PA (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>. The remuneration has taken into consideration the status and responsibility of the appointment, and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.</p>

    <p class="sec-hd">RESPONSIBILITIES:</p>
    <p class="para">You will work as <strong>&ldquo;${ol.designation}&rdquo;</strong> of the Company and will be responsible for carrying out the operations of the Company as directed to you by the management. A detailed responsibility statement will be provided to you upon your joining.</p>

    <p class="sec-hd">PROBATION PERIOD:</p>
    <p class="para">You will be on a probationary period of <strong>${probStr} months</strong> during which the services can be terminated from employer without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of probationary period.</p>

    <p class="sec-hd">SEPERATION OF SERVICES:</p>
    <p class="para">Severance of relationship can be done by giving <strong>${noticeStr} month</strong> written notice. If you are unable to complete this notice period you will be liable to compensate the company three months of salary or for the period not served.</p>

    <p class="sec-hd">OTHER RULES AND REGULATION:</p>
    <p class="para">The company will expect you to work in the Section / Department in which you are placed with a high standard of initiative, morality and economy.</p>
    <ul class="rules">
      <li>You will, in all respects, be governed by the company&rsquo;s rules and regulations</li>
      <li>You will devote full time to the work of the Company and will not undertake any direct / indirect outside business or work, honorary or remunerative except with the prior written consent of the Management.</li>
      <li>You will abide by Leave Rules of company.</li>
      <li>You have been engaged on the presumption that the particulars furnished by you in your application are correct. In case the said particular are found to be incorrect or that you have concealed or withheld</li>
    </ul>
  </div>
  ${ftrHTML}
</div>

<!-- PAGE 2 -->
<div class="page">
  ${hdrHTML}
  <div class="page-body">
    <p class="bullet-cont">information or the relevant facts, the services can be terminated from the company without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of period.</p>
    <ul class="rules">
      <li>You will not, either during the period of your services of thereafter, disclose divulge or communicate to any other person or group or company any strategic information of the organization or its clients.</li>
      <li>All correspondence addressed to you by the company including press and other copies of such correspondence and all vouchers, books, records, including all note books containing notes or records of business or prices or other market data, samples and/or other papers belonging to the company, circulars and all other relevant papers and documents of any nature whatsoever relating to the company&rsquo;s business, which shall come into your possession in the course of your employment shall be the absolute property of the company and you shall, at any time during your employment or upon termination there for any reason whatsoever, deliver the same to the company and without claiming any lien thereon.</li>
      <li>You will be responsible for the safe keeping and for returning in good condition and order, all on your own the company&rsquo;s property which may be in your use, custody, care or charge. The company shall have the right to deduct the monetary value of all such things from any amounts payable to you and to take such actions as may be deemed proper in the event of your failure to account for such property to the satisfaction of the management.</li>
      <li>You will keep us informed of your residential (mailing &amp; permanent) address. Any change in the same should be notified in writing within one week. Failure to do so will be treated as willful withholding of information and appropriate action as deemed fit by management would be taken against you.</li>
    </ul>

    ${ol.custom_clauses ? `<p class="sec-hd">ADDITIONAL TERMS:</p><p class="para">${ol.custom_clauses}</p>` : ''}

    <p class="para accept-bold">If you are willing to accept this offer for the said position, we request you to submit 3 copies of your latest coloured Passport Size photograph, Self-attested Copy of your academic qualification, Self-attested copy of your PAN Card, Self-attested copy of your Aadhar Card, Self-attested Copy of Address Proof, and last 3 month Pay Slip / Form 16 from your previous employer. In addition, upon joining, you will have to submit a copy of your relieving letter from your previous employer.</p>

    <p class="para">As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign the duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.</p>

    <div class="sig-section">
      <p class="sig-from">Yours truly,</p>
      <p class="sig-from">From <strong>Krishi Care &amp; Management Services Private Limited,</strong></p>
      <div class="sig-row">
        <div class="sig-col">
          ${ol.sig1_image ? `<img src="${ol.sig1_image}" class="sig-img" alt="">` : '<div class="sig-blank"></div>'}
          <p class="sig-lbl">Authorized Signatory</p>
        </div>
        <div class="sig-col" style="text-align:right;">
          ${ol.sig2_image ? `<img src="${ol.sig2_image}" class="sig-img" alt="" style="margin-left:auto;">` : '<div class="sig-blank"></div>'}
          <p class="sig-lbl">(Authorized Signatory)<br>Human Resource</p>
        </div>
      </div>
    </div>
  </div>
  ${ftrHTML}
</div>

<!-- PAGE 3: Annexure -->
<div class="page">
  ${hdrHTML}
  <div class="page-body">
    <p class="ann-title">Annexure I (Annual Cost to Company and Other Benefits)</p>
    <div class="ann-meta">
      <p>Name: ${ol.candidate_name}</p>
      <p>Designation: ${ol.designation}</p>
      <p>Location: ${ol.location||'Mumbai'}</p>
    </div>
    <p class="ann-ctc">Annual Cost to Company &ndash; Rs.${Number(ctcAnnual).toLocaleString('en-IN')} (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</p>
    <table class="ann-tbl">
      <thead>
        <tr>
          <th class="c-sr">Sr. No.</th>
          <th>Particulars</th>
          <th class="c-num">Monthly</th>
          <th class="c-num">Yearly</th>
        </tr>
      </thead>
      <tbody>
        <tr><td class="c-sr">1</td><td>Fixed Basic</td><td class="c-num">${fmtV(basic)}</td><td class="c-num">${fmtV(basic*12)}</td></tr>
        <tr><td class="c-sr">2</td><td>HRA</td><td class="c-num">${fmtV(hra)}</td><td class="c-num">${fmtV(hra*12)}</td></tr>
        ${conv>0?`<tr><td class="c-sr">2a</td><td>Conveyance Allowances</td><td class="c-num">${fmtV(conv)}</td><td class="c-num">${fmtV(conv*12)}</td></tr>`:''}
        <tr><td class="c-sr">3</td><td>Other Allowances</td><td class="c-num">${fmtV(other)}</td><td class="c-num">${fmtV(other*12)}</td></tr>
        <tr><td class="c-sr">4</td><td>Gratuity</td><td class="c-num">${fmtV(gratuity)}</td><td class="c-num">${fmtV(gratuity*12)}</td></tr>
        <tr class="r-bold"><td class="c-sr">5</td><td>Gross Pay</td><td class="c-num">${fmtV(gross)}</td><td class="c-num">${fmtV(gross*12)}</td></tr>
        <tr><td class="c-sr">6</td><td>Provident Fund</td><td class="c-num">${pfEmp>0?fmtV(pfEmp):'&ndash;'}</td><td class="c-num">${pfEmp>0?fmtV(pfEmp*12):'&ndash;'}</td></tr>
        <tr><td class="c-sr">7</td><td>Professional Tax</td><td class="c-num">${pt>0?fmtV(pt):'&ndash;'}</td><td class="c-num">${pt>0?fmtV(pt*12):'&ndash;'}</td></tr>
        <tr class="r-bold"><td class="c-sr">8</td><td>Total Deduction</td><td class="c-num">${totalDed>0?fmtV(totalDed):'&ndash;'}</td><td class="c-num">${totalDed>0?fmtV(totalDed*12):'&ndash;'}</td></tr>
        <tr class="r-bold"><td class="c-sr">9</td><td>Net Salary (Gross - Total Deduction)</td><td class="c-num">${fmtV(netSalary)}</td><td class="c-num">${fmtV(netSalary*12)}</td></tr>
        <tr><td class="c-sr">10</td><td>Employer PF contribution</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr):'&ndash;'}</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr*12):'&ndash;'}</td></tr>
        <tr><td class="c-sr">11</td><td>Employer PF contribution Admin charges</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin):'&ndash;'}</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin*12):'&ndash;'}</td></tr>
        <tr class="r-bold"><td class="c-sr">12</td><td>Total Compensation Package</td><td class="c-num">${fmtV(ctcMonthly)}</td><td class="c-num">${fmtV(ctcAnnual)}</td></tr>
      </tbody>
    </table>
    <div class="ack-box">
      <p class="ack-title">Acknowledgement &amp; Acceptance</p>
      <p class="ack-para">I have read understood, agree to the above terms and conditions, and hereby sign my acceptance of the same.</p>
      <div class="ack-row">
        <div class="ack-item">Signature: <span class="ack-line"></span></div>
        <div class="ack-item">Date: <span class="ack-line"></span></div>
      </div>
      <div class="ack-row">
        <div class="ack-item">Name: <span class="ack-line"></span></div>
        <div class="ack-item">Location: <span class="ack-line"></span></div>
      </div>
    </div>
  </div>
  ${ftrHTML}
</div>`;

  const annexure = ``;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #000;
    background: #bbb;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* One A4 page */
  .page {
    width: 210mm;
    min-height: 297mm;
    margin: 6mm auto;
    background: #fff;
    box-shadow: 0 2px 12px rgba(0,0,0,0.25);
    display: flex;
    flex-direction: column;
  }

  /* HEADER */
  .page-hdr  { flex-shrink: 0; padding: 8px 18mm 0; }
  .hdr-inner { display: table; width: 100%; border-collapse: collapse; }
  .hdr-logo-cell {
    display: table-cell;
    width: 82px;
    vertical-align: middle;
    padding-right: 8px;
  }
  .logo-img  { width: 76px; height: 82px; display: block; }
  .hdr-text-cell { display: table-cell; vertical-align: top; }
  .hdr-name  {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 18pt; font-weight: 900; color: #1a6b1a;
    line-height: 1.1; margin-bottom: 3px;
  }
  .hdr-addr  {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt; color: #111;
    text-align: center; line-height: 1.6;
  }
  .hdr-email {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt; color: #111;
    text-align: left; padding-left: 2px;
  }
  .hdr-rule  { border-bottom: 2.5px solid #1a6b1a; margin-top: 6px; }

  /* CONTENT */
  .page-body { flex: 1; padding: 16px 18mm 0; }

  /* FOOTER — pinned to bottom */
  .page-ftr  { flex-shrink: 0; margin-top: auto; padding: 6px 18mm 8px; }
  .ftr-rule  { border-top: 1px solid #555; margin-bottom: 4px; }
  .ftr-corp  { font-family: Arial, sans-serif; font-size: 7.5pt; text-align: center; color: #111; line-height: 1.6; }
  .ftr-cin   { font-family: Arial, sans-serif; font-size: 7.5pt; text-align: center; color: #111; }

  /* CONTENT STYLES — matching reference */
  .date-line  { text-align: right; font-size: 11pt; font-weight: bold; margin-bottom: 14px; }
  .cand-name  { font-size: 11pt; font-weight: bold; line-height: 1.6; }
  .cand-addr  { font-size: 11pt; line-height: 1.6; }
  .cand-meta  { margin: 10px 0; }
  .cand-meta p { font-size: 11pt; font-weight: bold; line-height: 1.6; }
  .elink      { color: #00f; text-decoration: underline; }
  .salut      { font-size: 11pt; margin: 14px 0 6px; }
  .subj-line  {
    font-size: 11pt; font-weight: bold; text-decoration: underline;
    text-align: center; margin: 14px 40px 14px; line-height: 1.5;
  }
  .para { font-size: 11pt; line-height: 1.6; text-align: justify; margin-bottom: 10px; }
  .accept-bold { font-weight: bold; }

  .sec-hd {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt; font-weight: bold; text-decoration: underline;
    margin: 12px 0 5px; padding-left: 6px; color: #000;
  }

  ul.rules {
    margin: 6px 0 10px 36px;
    padding: 0;
    list-style: disc;
  }
  ul.rules li {
    font-size: 11pt; line-height: 1.6;
    margin-bottom: 8px; text-align: justify;
  }

  /* Page 2 continuation text (not a bullet) */
  .bullet-cont {
    font-size: 11pt; line-height: 1.6; text-align: justify;
    margin: 0 0 8px 36px;
  }

  .sig-section { margin-top: 16px; }
  .sig-from    { font-size: 11pt; margin-bottom: 3px; line-height: 1.6; }
  .sig-row     { display: flex; justify-content: space-between; margin-top: 48px; }
  .sig-col     { width: 44%; }
  .sig-img     { height: 44px; display: block; margin-bottom: 2px; }
  .sig-blank   { height: 44px; }
  .sig-lbl     { font-size: 11pt; }

  /* ANNEXURE */
  .ann-title { font-size: 11pt; font-weight: bold; text-align: center; margin: 14px 0 16px; }
  .ann-meta  { margin-bottom: 14px; }
  .ann-meta p { font-size: 11pt; font-weight: bold; line-height: 1.7; }
  .ann-ctc   { font-size: 11pt; font-weight: bold; margin-bottom: 12px; }

  .ann-tbl { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11pt; }
  .ann-tbl th {
    font-weight: bold; padding: 8px 10px;
    text-align: center; border: 1px solid #000;
    background: #fff;
  }
  .ann-tbl td { border: 1px solid #000; padding: 7px 10px; }
  .c-sr  { text-align: center; width: 60px; }
  .c-num { text-align: center; width: 110px; }
  .r-bold td { font-weight: bold; }

  .ack-box   { margin-top: 22px; }
  .ack-title { font-size: 11pt; font-weight: bold; text-decoration: underline; margin-bottom: 10px; }
  .ack-para  { font-size: 11pt; line-height: 1.6; margin-bottom: 28px; }
  .ack-row   { display: flex; justify-content: space-between; margin-bottom: 24px; }
  .ack-item  { font-size: 11pt; }
  .ack-line  { display: inline-block; border-bottom: 1px solid #000; width: 140px; margin-left: 4px; vertical-align: bottom; }

  @media print {
    body { margin: 0; background: #fff; }
    .page {
      width: 100%; min-height: 297mm; margin: 0;
      box-shadow: none; page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
  }
</style>
</head>
<body>
${mainLetter}
</body>
</html>`;}


// ── GET /offer-letters — list all ─────────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ol.*, CONCAT(e.first_name,' ',e.last_name) AS created_by_name
      FROM offer_letters ol
      LEFT JOIN employees e ON ol.created_by = e.id
      ORDER BY ol.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[offerLetter.getAll]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /offer-letters/:id — get one ─────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── POST /offer-letters — create ─────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      candidate_name, candidate_email, candidate_address, candidate_mobile,
      designation, location = 'Mumbai', joining_date, offer_date, offer_valid_days = 7,
      ctc_annual, basic_monthly, hra_monthly, conveyance_monthly = 0,
      other_allowance_monthly, gratuity_monthly = 0,
      pf_employee_monthly = 0, pf_employer_monthly = 0, pf_admin_monthly = 0,
      professional_tax_monthly = 0,
      probation_months = 6, notice_period_months = 3, custom_clauses, employee_id,
      employee_code,
      sig1_image, sig2_image
    } = req.body;

    if (!candidate_name || !designation)
      return res.status(400).json({ success: false, message: 'candidate_name and designation required' });

    const result = await db.query(`
      INSERT INTO offer_letters (
        employee_id, candidate_name, candidate_email, candidate_address, candidate_mobile,
        designation, location, joining_date, offer_date, offer_valid_days,
        ctc_annual, basic_monthly, hra_monthly, conveyance_monthly, other_allowance_monthly,
        gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
        professional_tax_monthly, employee_code,
        probation_months, notice_period_months, custom_clauses, sig1_image, sig2_image,
        created_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW())
      RETURNING *`,
      [employee_id||null, candidate_name, candidate_email||null, candidate_address||null, candidate_mobile||null,
       designation, location, joining_date||null, offer_date||null, offer_valid_days,
       ctc_annual||0, basic_monthly||0, hra_monthly||0, conveyance_monthly, other_allowance_monthly||0,
       gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
       professional_tax_monthly||0, employee_code||null,
       probation_months, notice_period_months, custom_clauses||null, sig1_image||null, sig2_image||null,
       req.user.id]
    );
    res.json({ success: true, data: result.rows[0], message: 'Offer letter created!' });
  } catch (err) {
    console.error('[offerLetter.create]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── PUT /offer-letters/:id — update ──────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const fields = ['candidate_name','candidate_email','candidate_address','candidate_mobile',
      'designation','location','joining_date','offer_date','offer_valid_days',
      'ctc_annual','basic_monthly','hra_monthly','conveyance_monthly','other_allowance_monthly',
      'gratuity_monthly','pf_employee_monthly','pf_employer_monthly','pf_admin_monthly',
      'professional_tax_monthly','employee_code',
      'probation_months','notice_period_months','custom_clauses','sig1_image','sig2_image'];
    const sets = [], params = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        sets.push(`${f}=$${params.length+1}`);
        params.push(req.body[f]);
      }
    });
    if (!sets.length) return res.json({ success: true, message: 'Nothing to update' });
    sets.push(`updated_at=NOW()`);
    params.push(req.params.id);
    await db.query(`UPDATE offer_letters SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    res.json({ success: true, message: 'Updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /offer-letters/:id/preview — HTML preview ───────────────────────────
exports.preview = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).send('Not found');
    const ol = result.rows[0];
    let html = buildOfferLetterHTML(ol);
    // Inject auto-print script before </body> so user can save as PDF
    const printScript = `
<style>
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
<div id="pdf-bar" style="position:fixed;top:0;left:0;right:0;background:#1B5E20;color:white;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;z-index:9999;font-family:sans-serif;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.3);">
  <span>📄 Offer Letter Preview</span>
  <div style="display:flex;gap:10px;">
    <button onclick="window.print()" style="background:#fff;color:#1B5E20;border:none;padding:8px 18px;border-radius:6px;font-weight:700;cursor:pointer;font-size:14px;">⬇️ Download / Save as PDF</button>
    <button onclick="document.getElementById('pdf-bar').style.display='none'" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;">✕ Hide Bar</button>
  </div>
</div>
<div style="height:52px;"></div>
<script>
  // Auto-show print dialog after a short delay
  window.addEventListener('load', () => {
    document.title = 'Offer_Letter_${ol.candidate_name.replace(/'/g,"\'")}';
  });
<\/script>`;
    html = html.replace('</body>', printScript + '</body>');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Server error');
  }
};

// ── POST /offer-letters/:id/send — email offer letter ───────────────────────
exports.sendEmail = async (req, res) => {
  try {
    const { cc = [], bcc = [], email_message = '' } = req.body;
    const result = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const ol = result.rows[0];
    if (!ol.candidate_email) return res.status(400).json({ success: false, message: 'No email on this offer letter' });

    // ── Build the offer letter HTML ─────────────────────────────────────────
    const offerHTML = buildOfferLetterHTML(ol);

    // ── Generate PDF via wkhtmltopdf with --header-html and --footer-html ───
    // Header and footer repeat automatically on every page.
    // The HTML body has .doc-header and .doc-footer hidden via @media print,
    // so there's no duplication — wkhtmltopdf handles them natively.
    let offerPdfBuffer = null;
    try {
      const tmpDir  = os.tmpdir();
      const stamp   = Date.now();
      const tmpHtml = path.join(tmpDir, `offer_${ol.id}_${stamp}.html`);
      const tmpPdf  = path.join(tmpDir, `offer_${ol.id}_${stamp}.pdf`);

      fs.writeFileSync(tmpHtml, offerHTML);

      await new Promise((resolve, reject) => {
        execFile('wkhtmltopdf', [
          '--quiet',
          '--page-size',   'A4',
          '--margin-top',  '0',
          '--margin-bottom','0',
          '--margin-left', '0',
          '--margin-right','0',
          '--encoding',    'utf-8',
          '--enable-local-file-access',
          tmpHtml, tmpPdf
        ], { maxBuffer: 20 * 1024 * 1024 }, (err) => { if (err) return reject(err); resolve(); });
      });

      offerPdfBuffer = fs.readFileSync(tmpPdf);
      try { fs.unlinkSync(tmpHtml); fs.unlinkSync(tmpPdf); } catch(_) {}
      console.log('[offerLetter.sendEmail] PDF generated, size:', offerPdfBuffer.length);
    } catch (pdfErr) {
      console.error('[offerLetter.sendEmail] PDF generation failed:', pdfErr.message);
    }

    // ── Cover email body ────────────────────────────────────────────────────
    const defaultMsg = `Dear ${ol.candidate_name.split(' ')[0] || ol.candidate_name},\n\nPlease find attached your offer letter for the position of "${ol.designation}" at Krishi Care & Management Services Private Limited.\n\nKindly review the letter and revert back with your acceptance within ${ol.offer_valid_days || 7} days.\n\nPlease also find attached the Joining Form. Kindly fill it and submit upon joining.\n\nFor any queries, feel free to reach out to us.\n\nWarm regards,\nHuman Resource Team\nKrishi Care & Management Services Pvt. Ltd.`;

    const coverText = (email_message || defaultMsg).replace(/\n/g, '<br>');

    const coverHtml = `
      <div style="font-family:Arial,sans-serif;font-size:13px;color:#222;line-height:1.7;max-width:600px;">
        <div style="background:#1B5E20;padding:16px 24px;border-radius:8px 8px 0 0;">
          <span style="color:#fff;font-size:16px;font-weight:700;">KrishiHR</span>
          <span style="color:#A5D6A7;font-size:12px;margin-left:8px;">Krishi Care &amp; Management Services</span>
        </div>
        <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
          <p>${coverText}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="font-size:11px;color:#999;"><strong>Attachments:</strong><br>
            &#128196; Offer Letter (PDF)<br>
            &#128203; Joining Form (DOCX &amp; PDF) — Please fill and submit on joining day
          </p>
        </div>
      </div>`;

    // ── Build attachments array ──────────────────────────────────────────────
    const attachments = [];

    // 1. Offer Letter — always as PDF
    if (offerPdfBuffer) {
      attachments.push({
        name:    `Offer_Letter_${ol.candidate_name.replace(/\s+/g,'_')}.pdf`,
        content: offerPdfBuffer.toString('base64'),
      });
    } else {
      // Last resort fallback: send HTML file
      attachments.push({
        name:    `Offer_Letter_${ol.candidate_name.replace(/\s+/g,'_')}.html`,
        content: Buffer.from(offerHTML).toString('base64'),
      });
    }

    // 2. Joining Form DOCX — always attach if file exists
    const joiningFormPath = path.join(__dirname, '..', 'assets', 'Joining_form_Krishi_Care.docx');
    if (fs.existsSync(joiningFormPath)) {
      const docxBuffer = fs.readFileSync(joiningFormPath);
      attachments.push({
        name:    'Joining_Form_Krishi_Care.docx',
        content: docxBuffer.toString('base64'),
      });

      // 3. Joining Form as PDF — best-effort via LibreOffice
      try {
        const tmpDocx = path.join(os.tmpdir(), `joining_form_${Date.now()}.docx`);
        fs.writeFileSync(tmpDocx, docxBuffer);

        await new Promise((resolve, reject) => {
          execFile('libreoffice', [
            '--headless', '--convert-to', 'pdf',
            '--outdir', os.tmpdir(),
            tmpDocx
          ], (err) => { if (err) return reject(err); resolve(); });
        });

        const libreOutPdf = tmpDocx.replace(/\.docx$/, '.pdf');
        if (fs.existsSync(libreOutPdf)) {
          const pdfJoiningBuffer = fs.readFileSync(libreOutPdf);
          try { fs.unlinkSync(tmpDocx); fs.unlinkSync(libreOutPdf); } catch(_) {}
          attachments.push({
            name:    'Joining_Form_Krishi_Care.pdf',
            content: pdfJoiningBuffer.toString('base64'),
          });
          console.log('[offerLetter.sendEmail] Joining form PDF attached successfully');
        } else {
          try { fs.unlinkSync(tmpDocx); } catch(_) {}
        }
      } catch (joiningPdfErr) {
        console.warn('[offerLetter.sendEmail] Joining form PDF skipped (LibreOffice not available):', joiningPdfErr.message);
        // DOCX is already attached — PDF is best-effort only
      }
    } else {
      console.warn('[offerLetter.sendEmail] Joining form not found at:', joiningFormPath);
    }

    // ── Brevo payload with all attachments ───────────────────────────────────
    const payload = {
      sender:      { name: process.env.EMAIL_FROM_NAME || 'KrishiHR', email: process.env.EMAIL_FROM || 'anonymous.agritech@gmail.com' },
      to:          [{ email: ol.candidate_email, name: ol.candidate_name }],
      subject:     `Offer Letter — ${ol.designation} | Krishi Care & Management Services`,
      htmlContent: coverHtml,
      attachment:  attachments,
    };

    const cleanCc  = (Array.isArray(cc)  ? cc  : []).map(e => (e||'').trim()).filter(e => e && e.includes('@'));
    const cleanBcc = (Array.isArray(bcc) ? bcc : []).map(e => (e||'').trim()).filter(e => e && e.includes('@'));
    if (cleanCc.length)  payload.cc  = cleanCc.map(e => ({ email: e }));
    if (cleanBcc.length) payload.bcc = cleanBcc.map(e => ({ email: e }));

    const BREVO_KEY = process.env.BREVO_API_KEY;
    if (!BREVO_KEY || process.env.EMAIL_ENABLED !== 'true') {
      await db.query(`UPDATE offer_letters SET status='sent', sent_at=NOW() WHERE id=$1`, [ol.id]);
      return res.json({
        success: true,
        message: `[Simulated] Offer letter sent to ${ol.candidate_email} with ${attachments.length} attachment(s): ${attachments.map(a => a.name).join(', ')}`
      });
    }

    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ success: false, message: `Email failed: ${err}` });
    }

    await db.query(`UPDATE offer_letters SET status='sent', sent_at=NOW() WHERE id=$1`, [ol.id]);
    res.json({ success: true, message: `Offer letter sent to ${ol.candidate_email} with ${attachments.length} attachment(s)` });
  } catch (err) {
    console.error('[offerLetter.sendEmail]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── DELETE /offer-letters/:id ─────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await db.query('DELETE FROM offer_letters WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
