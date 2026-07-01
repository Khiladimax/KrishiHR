-- ════════════════════════════════════════════════════════════════════════════
-- CLIENT PAYROLL CYCLES — monthly gross salary, TDS @1%, amount payable
-- Cycle: 25th of previous month → 24th of selected month
-- Table: client_payroll_cycles
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_payroll_cycles (
  id              SERIAL PRIMARY KEY,
  employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle_month     INT  NOT NULL CHECK (cycle_month BETWEEN 1 AND 12),  -- selected month (e.g. 2 = Feb cycle = 25 Jan → 24 Feb)
  cycle_year      INT  NOT NULL,
  gross_salary    NUMERIC(12,2) NOT NULL DEFAULT 0,
  tds_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,   -- TDS @1% of gross
  amount_payable  NUMERIC(12,2) NOT NULL DEFAULT 0,   -- gross - tds
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (employee_id, cycle_month, cycle_year)
);

CREATE INDEX IF NOT EXISTS idx_client_payroll_emp    ON client_payroll_cycles(employee_id);
CREATE INDEX IF NOT EXISTS idx_client_payroll_cycle  ON client_payroll_cycles(cycle_year, cycle_month);

-- ── SEED DATA ────────────────────────────────────────────────────────────────
-- Cycles present in the data:
--   Feb-Mar 2026  → cycle_month=2, cycle_year=2026  (25 Jan → 24 Feb)
--   Mar-Apr 2026  → cycle_month=3, cycle_year=2026  (25 Feb → 24 Mar)
--   Apr-May 2026  → cycle_month=4, cycle_year=2026  (25 Mar → 24 Apr)

INSERT INTO client_payroll_cycles
  (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 20000, 200, 19800   FROM employees e WHERE e.employee_code = 'KC1886'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE
  SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

INSERT INTO client_payroll_cycles
  (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20000, 200, 19800   FROM employees e WHERE e.employee_code = 'KC1886'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE
  SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

INSERT INTO client_payroll_cycles
  (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 18000, 180, 17820   FROM employees e WHERE e.employee_code = 'KC1886'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE
  SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC264 — Ganapati Giramala Honnalli
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 22733, 227, 22506  FROM employees e WHERE e.employee_code = 'KC264'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 21290, 213, 21077  FROM employees e WHERE e.employee_code = 'KC264'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 21267, 213, 21054  FROM employees e WHERE e.employee_code = 'KC264'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC3309 — Chandappa Bhimsha Rokade
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 18000, 180, 17820  FROM employees e WHERE e.employee_code = 'KC3309'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 16839, 168, 16671  FROM employees e WHERE e.employee_code = 'KC3309'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 16200, 162, 16038  FROM employees e WHERE e.employee_code = 'KC3309'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC3828 — Santosh Basavraj Ragi
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 19286, 193, 19093  FROM employees e WHERE e.employee_code = 'KC3828'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 18065, 181, 17884  FROM employees e WHERE e.employee_code = 'KC3828'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC3828'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6476 — Sunil Manu Pawar
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 22000, 220, 21780  FROM employees e WHERE e.employee_code = 'KC6476'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 21290, 213, 21077  FROM employees e WHERE e.employee_code = 'KC6476'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 18333, 183, 18150  FROM employees e WHERE e.employee_code = 'KC6476'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6485 — B Akash Reddy
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 25071, 251, 24820  FROM employees e WHERE e.employee_code = 'KC6485'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 24323, 243, 24080  FROM employees e WHERE e.employee_code = 'KC6485'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 21667, 217, 21450  FROM employees e WHERE e.employee_code = 'KC6485'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6477 — Bheemappa M Balabatti
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 22000, 220, 21780  FROM employees e WHERE e.employee_code = 'KC6477'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20581, 206, 20375  FROM employees e WHERE e.employee_code = 'KC6477'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 21267, 213, 21054  FROM employees e WHERE e.employee_code = 'KC6477'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6479 — Rahul Malikarjun Patil
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 22000, 220, 21780  FROM employees e WHERE e.employee_code = 'KC6479'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 22000, 220, 21780  FROM employees e WHERE e.employee_code = 'KC6479'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 21267, 213, 21054  FROM employees e WHERE e.employee_code = 'KC6479'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6480 — Somalingayya Sharanayya Hiremath
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 22734, 227, 22507  FROM employees e WHERE e.employee_code = 'KC6480'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20581, 206, 20375  FROM employees e WHERE e.employee_code = 'KC6480'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 20533, 205, 20328  FROM employees e WHERE e.employee_code = 'KC6480'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6481 — Kisan Togu Naik
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC6481'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 19355, 194, 19161  FROM employees e WHERE e.employee_code = 'KC6481'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 18667, 187, 18480  FROM employees e WHERE e.employee_code = 'KC6481'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6482 — Malingaraya Doddappa Shiledar
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 22000, 220, 21780  FROM employees e WHERE e.employee_code = 'KC6482'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20581, 206, 20375  FROM employees e WHERE e.employee_code = 'KC6482'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 21267, 213, 21054  FROM employees e WHERE e.employee_code = 'KC6482'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6484 — Gunderao Mallikarjuna Policepatil
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 20667, 207, 20460  FROM employees e WHERE e.employee_code = 'KC6484'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC6484'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 18667, 187, 18480  FROM employees e WHERE e.employee_code = 'KC6484'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6475 — Natesha Babau P T
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 24000, 240, 23760  FROM employees e WHERE e.employee_code = 'KC6475'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 23226, 232, 22994  FROM employees e WHERE e.employee_code = 'KC6475'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 23200, 232, 22968  FROM employees e WHERE e.employee_code = 'KC6475'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6486 — Srinivasa Venkateshappa
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC6486'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC6486'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 18667, 187, 18480  FROM employees e WHERE e.employee_code = 'KC6486'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6487 — Chethan Kumar M S
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 18000, 180, 17820  FROM employees e WHERE e.employee_code = 'KC6487'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 18000, 180, 17820  FROM employees e WHERE e.employee_code = 'KC6487'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 16200, 162, 16038  FROM employees e WHERE e.employee_code = 'KC6487'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6488 — Hareesha Narayana Reddy
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 18000, 180, 17820  FROM employees e WHERE e.employee_code = 'KC6488'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 18000, 180, 17820  FROM employees e WHERE e.employee_code = 'KC6488'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 16800, 168, 16632  FROM employees e WHERE e.employee_code = 'KC6488'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC8997 — Narasimhamurthy G
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC8997'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC8997'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 18000, 180, 17820  FROM employees e WHERE e.employee_code = 'KC8997'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC2156 — Ravindra Naga Mogaveera
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 21429, 214, 21215  FROM employees e WHERE e.employee_code = 'KC2156'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 24000, 240, 23760  FROM employees e WHERE e.employee_code = 'KC2156'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 22400, 224, 22176  FROM employees e WHERE e.employee_code = 'KC2156'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();

-- KC6864 — Yamuna M
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 2, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC6864'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 3, 2026, 20000, 200, 19800  FROM employees e WHERE e.employee_code = 'KC6864'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
INSERT INTO client_payroll_cycles (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
SELECT e.id, 4, 2026, 19333, 193, 19140  FROM employees e WHERE e.employee_code = 'KC6864'
ON CONFLICT (employee_id, cycle_month, cycle_year) DO UPDATE SET gross_salary=EXCLUDED.gross_salary, tds_amount=EXCLUDED.tds_amount, amount_payable=EXCLUDED.amount_payable, updated_at=NOW();
