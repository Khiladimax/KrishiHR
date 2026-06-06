package com.krishihr.app.ui.more

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.*
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.krishihr.app.R
import com.krishihr.app.data.api.RetrofitClient
import com.krishihr.app.data.models.GeofenceEmployeeRow
import com.krishihr.app.data.models.GeofenceLocation
import kotlinx.coroutines.launch

class GeofenceAdminFragment : Fragment() {

    private var allEmployees: List<GeofenceEmployeeRow> = emptyList()
    private var locations: List<GeofenceLocation> = emptyList()
    private var currentRuleFilter = "all"

    private lateinit var llList: LinearLayout
    private lateinit var tvEmpty: TextView
    private lateinit var pbLoading: ProgressBar
    private lateinit var etSearch: EditText
    private lateinit var spinnerRule: Spinner

    // ── India state/district data ────────────────────────────────────────────
    private val BR_STATES = listOf(
        "ANDAMAN & NICOBAR", "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR",
        "CHANDIGARH", "CHHATTISGARH", "DADRA,NAGAR HAVELI,DAMAN & DIU", "DELHI", "GOA",
        "GUJARAT", "HARYANA", "HIMACHAL PRADESH", "JAMMU & KASHMIR", "JHARKHAND",
        "KARNATAKA", "KERALA", "LADAKH", "LAKSHADWEEP", "MADHYA PRADESH", "MAHARASHTRA",
        "MANIPUR", "MEGHALAYA", "MIZORAM", "NAGALAND", "ODISHA", "PUDUCHERRY", "PUNJAB",
        "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TELANGANA", "TRIPURA", "UTTAR PRADESH",
        "UTTARAKHAND", "WEST BENGAL"
    )

    private val BR_DISTRICTS = mapOf(
        "ANDAMAN & NICOBAR" to listOf("Nicobars","North And Middle Andaman","South Andamans"),
        "ANDHRA PRADESH" to listOf("Alluri Sitharama Raju","Anakapalli","Anantapur","Annamayya","Bapatla","Chittoor","East Godavari","Eluru","Guntur","Kakinada","Konaseema","Krishna","Kurnool","Nandyal","Ntr","Palnadu","Parvathipuram Manyam","Prakasam","Spsr Nellore","Sri Sathya Sai","Srikakulam","Tirupati","Visakhapatanam","Vizianagaram","West Godavari","Y.S.R."),
        "ARUNACHAL PRADESH" to listOf("Anjaw","Changlang","Dibang Valley","East Kameng","East Siang","Kamle","Kra Daadi","Kurung Kumey","Leparada","Lohit","Longding","Lower Dibang Valley","Lower Siang","Lower Subansiri","Namsai","Pakke Kessang","Papum Pare","Shi Yomi","Siang","Tawang","Tirap","Upper Siang","Upper Subansiri","West Kameng","West Siang"),
        "ASSAM" to listOf("Bajali","Baksa","Barpeta","Biswanath","Bongaigaon","Cachar","Charaideo","Chirang","Darrang","Dhemaji","Dhubri","Dibrugarh","Dima Hasao","Goalpara","Golaghat","Hailakandi","Hojai","Jorhat","Kamrup","Kamrup Metro","Karbi Anglong","Karimganj","Kokrajhar","Lakhimpur","Majuli","Marigaon","Nagaon","Nalbari","Sivasagar","Sonitpur","South Salmara Mancachar","Tamulpur","Tinsukia","Udalguri","West Karbi Anglong"),
        "BIHAR" to listOf("Araria","Arwal","Aurangabad","Banka","Begusarai","Bhagalpur","Bhojpur","Buxar","Darbhanga","Gaya","Gopalganj","Jamui","Jehanabad","Kaimur (Bhabua)","Katihar","Khagaria","Kishanganj","Lakhisarai","Madhepura","Madhubani","Munger","Muzaffarpur","Nalanda","Nawada","Pashchim Champaran","Patna","Purbi Champaran","Purnia","Rohtas","Saharsa","Samastipur","Saran","Sheikhpura","Sheohar","Sitamarhi","Siwan","Supaul","Vaishali"),
        "CHANDIGARH" to listOf("Chandigarh"),
        "CHHATTISGARH" to listOf("Balod","Baloda Bazar","Balrampur","Bastar","Bemetara","Bijapur","Bilaspur","Dantewada","Dhamtari","Durg","Gariyaband","Gaurella Pendra Marwahi","Janjgir-Champa","Jashpur","Kabirdham","Kanker","Khairgarh Chhuikhadan Gandai","Kondagaon","Korba","Korea","Mahasamund","Manendragarh Chirimiri Bharatpur","Mohla Manpur Ambagarh Chouki","Mungeli","Narayanpur","Raigarh","Raipur","Rajnandgaon","Sakti","Sarangarh Bilaigarh","Sukma","Surajpur","Surguja"),
        "DADRA,NAGAR HAVELI,DAMAN & DIU" to listOf("Dadra And Nagar Haveli","Daman","Diu"),
        "DELHI" to listOf("Central","East","New Delhi","North","North East","North West","Shahdara","South","South East","South West","West"),
        "GOA" to listOf("North Goa","South Goa"),
        "GUJARAT" to listOf("Ahmadabad","Amreli","Anand","Arvalli","Banas Kantha","Bharuch","Bhavnagar","Botad","Chhotaudepur","Dang","Devbhumi Dwarka","Dohad","Gandhinagar","Gir Somnath","Jamnagar","Junagadh","Kachchh","Kheda","Mahesana","Mahisagar","Morbi","Narmada","Navsari","Panch Mahals","Patan","Porbandar","Rajkot","Sabar Kantha","Surat","Surendranagar","Tapi","Vadodara","Valsad"),
        "HARYANA" to listOf("Ambala","Bhiwani","Charki Dadri","Faridabad","Fatehabad","Gurugram","Hisar","Jhajjar","Jind","Kaithal","Karnal","Kurukshetra","Mahendragarh","Nuh","Palwal","Panchkula","Panipat","Rewari","Rohtak","Sirsa","Sonipat","Yamunanagar"),
        "HIMACHAL PRADESH" to listOf("Bilaspur","Chamba","Hamirpur","Kangra","Kinnaur","Kullu","Lahul And Spiti","Mandi","Shimla","Sirmaur","Solan","Una"),
        "JAMMU & KASHMIR" to listOf("Anantnag","Bandipora","Baramulla","Budgam","Doda","Ganderbal","Jammu","Kathua","Kishtwar","Kulgam","Kupwara","Mirpur","Muzaffarabad","Poonch","Pulwama","Rajouri","Ramban","Reasi","Samba","Shopian","Srinagar","Udhampur"),
        "JHARKHAND" to listOf("Bokaro","Chatra","Deoghar","Dhanbad","Dumka","East Singhbum","Garhwa","Giridih","Godda","Gumla","Hazaribagh","Jamtara","Khunti","Koderma","Latehar","Lohardaga","Pakur","Palamu","Ramgarh","Ranchi","Sahebganj","Saraikela Kharsawan","Simdega","West Singhbhum"),
        "KARNATAKA" to listOf("Bagalkote","Ballari","Belagavi","Bengaluru Rural","Bengaluru Urban","Bidar","Chamarajanagara","Chikkaballapura","Chikkamagaluru","Chitradurga","Dakshina Kannada","Davangere","Dharwad","Gadag","Hassan","Haveri","Kalaburagi","Kodagu","Kolar","Koppal","Mandya","Mysuru","Raichur","Ramanagara","Shivamogga","Tumakuru","Udupi","Uttara Kannada","Vijayanagar","Vijayapura","Yadgir"),
        "KERALA" to listOf("Alappuzha","Ernakulam","Idukki","Kannur","Kasaragod","Kollam","Kottayam","Kozhikode","Malappuram","Palakkad","Pathanamthitta","Thiruvananthapuram","Thrissur","Wayanad"),
        "LADAKH" to listOf("Kargil","Leh Ladakh"),
        "LAKSHADWEEP" to listOf("Lakshadweep District"),
        "MADHYA PRADESH" to listOf("Agar Malwa","Alirajpur","Anuppur","Ashoknagar","Balaghat","Barwani","Betul","Bhind","Bhopal","Burhanpur","Chhatarpur","Chhindwara","Damoh","Datia","Dewas","Dhar","Dindori","East Nimar","Guna","Gwalior","Harda","Indore","Jabalpur","Jhabua","Katni","Khargone","Mandla","Mandsaur","Morena","Narmadapuram","Narsinghpur","Neemuch","Niwari","Panna","Raisen","Rajgarh","Ratlam","Rewa","Sagar","Satna","Sehore","Seoni","Shahdol","Shajapur","Sheopur","Shivpuri","Sidhi","Singrauli","Tikamgarh","Ujjain","Umaria","Vidisha"),
        "MAHARASHTRA" to listOf("Ahmednagar","Akola","Amravati","Aurangabad","Beed","Bhandara","Buldhana","Chandrapur","Dhule","Gadchiroli","Gondia","Hingoli","Jalgaon","Jalna","Kolhapur","Latur","Mumbai","Mumbai Suburban","Nagpur","Nanded","Nandurbar","Nashik","Osmanabad","Palghar","Parbhani","Pune","Raigad","Ratnagiri","Sangli","Satara","Sindhudurg","Solapur","Thane","Wardha","Washim","Yavatmal"),
        "MANIPUR" to listOf("Bishnupur","Chandel","Churachandpur","Imphal East","Imphal West","Jiribam","Kakching","Kamjong","Kangpokpi","Noney","Pherzawl","Senapati","Tamenglong","Tengnoupal","Thoubal","Ukhrul"),
        "MEGHALAYA" to listOf("East Garo Hills","East Jaintia Hills","East Khasi Hills","Eastern West Khasi Hills","North Garo Hills","Ri Bhoi","South Garo Hills","South West Garo Hills","South West Khasi Hills","West Garo Hills","West Jaintia Hills","West Khasi Hills"),
        "MIZORAM" to listOf("Aizawl","Champhai","Hnahthial","Khawzawl","Kolasib","Lawngtlai","Lunglei","Mamit","Saiha","Saitual","Serchhip"),
        "NAGALAND" to listOf("Chumoukedima","Dimapur","Kiphire","Kohima","Longleng","Mokokchung","Mon","Niuland","Noklak","Peren","Phek","Shamator","Tseminyu","Tuensang","Wokha","Zunheboto"),
        "ODISHA" to listOf("Anugul","Balangir","Baleshwar","Bargarh","Bhadrak","Boudh","Cuttack","Deogarh","Dhenkanal","Gajapati","Ganjam","Jagatsinghapur","Jajapur","Jharsuguda","Kalahandi","Kandhamal","Kendrapara","Kendujhar","Khordha","Koraput","Malkangiri","Mayurbhanj","Nabarangpur","Nayagarh","Nuapada","Puri","Rayagada","Sambalpur","Sonepur","Sundargarh"),
        "PUDUCHERRY" to listOf("Karaikal","Mahe","Pondicherry","Yanam"),
        "PUNJAB" to listOf("Amritsar","Barnala","Bathinda","Faridkot","Fatehgarh Sahib","Fazilka","Ferozepur","Gurdaspur","Hoshiarpur","Jalandhar","Kapurthala","Ludhiana","Malerkotla","Mansa","Moga","Pathankot","Patiala","Rupnagar","S.A.S Nagar","Sangrur","Shahid Bhagat Singh Nagar","Sri Muktsar Sahib","Tarn Taran"),
        "RAJASTHAN" to listOf("Ajmer","Alwar","Banswara","Baran","Barmer","Bharatpur","Bhilwara","Bikaner","Bundi","Chittorgarh","Churu","Dausa","Dholpur","Dungarpur","Ganganagar","Hanumangarh","Jaipur","Jaisalmer","Jalore","Jhalawar","Jhunjhunu","Jodhpur","Karauli","Kota","Nagaur","Pali","Pratapgarh","Rajsamand","Sawai Madhopur","Sikar","Sirohi","Tonk","Udaipur"),
        "SIKKIM" to listOf("Gangtok","Gyalshing","Mangan","Namchi","Pakyong","Soreng"),
        "TAMIL NADU" to listOf("Ariyalur","Chengalpattu","Chennai","Coimbatore","Cuddalore","Dharmapuri","Dindigul","Erode","Kallakurichi","Kanchipuram","Kanniyakumari","Karur","Krishnagiri","Madurai","Mayiladuthurai","Nagapattinam","Namakkal","Perambalur","Pudukkottai","Ramanathapuram","Ranipet","Salem","Sivaganga","Tenkasi","Thanjavur","The Nilgiris","Theni","Thiruvallur","Thiruvarur","Tiruchirappalli","Tirunelveli","Tirupathur","Tiruppur","Tiruvannamalai","Tuticorin","Vellore","Villupuram","Virudhunagar"),
        "TELANGANA" to listOf("Adilabad","Bhadradri Kothagudem","Hanumakonda","Hyderabad","Jagitial","Jangoan","Jayashankar Bhupalapally","Jogulamba Gadwal","Kamareddy","Karimnagar","Khammam","Kumuram Bheem Asifabad","Mahabubabad","Mahabubnagar","Mancherial","Medak","Medchal Malkajgiri","Mulugu","Nagarkurnool","Nalgonda","Narayanpet","Nirmal","Nizamabad","Peddapalli","Rajanna Sircilla","Ranga Reddy","Sangareddy","Siddipet","Suryapet","Vikarabad","Wanaparthy","Warangal","Yadadri Bhuvanagiri"),
        "TRIPURA" to listOf("Dhalai","Gomati","Khowai","North Tripura","Sepahijala","South Tripura","Unakoti","West Tripura"),
        "UTTAR PRADESH" to listOf("Agra","Aligarh","Ambedkar Nagar","Amethi","Amroha","Auraiya","Ayodhya","Azamgarh","Baghpat","Bahraich","Ballia","Balrampur","Banda","Barabanki","Bareilly","Basti","Bhadohi","Bijnor","Budaun","Bulandshahr","Chandauli","Chitrakoot","Deoria","Etah","Etawah","Farrukhabad","Fatehpur","Firozabad","Gautam Buddha Nagar","Ghaziabad","Ghazipur","Gonda","Gorakhpur","Hamirpur","Hapur","Hardoi","Hathras","Jalaun","Jaunpur","Jhansi","Kannauj","Kanpur Dehat","Kanpur Nagar","Kasganj","Kaushambi","Kheri","Kushi Nagar","Lalitpur","Lucknow","Maharajganj","Mahoba","Mainpuri","Mathura","Mau","Meerut","Mirzapur","Moradabad","Muzaffarnagar","Pilibhit","Pratapgarh","Prayagraj","Rae Bareli","Rampur","Saharanpur","Sambhal","Sant Kabeer Nagar","Shahjahanpur","Shamli","Shravasti","Siddharth Nagar","Sitapur","Sonbhadra","Sultanpur","Unnao","Varanasi"),
        "UTTARAKHAND" to listOf("Almora","Bageshwar","Chamoli","Champawat","Dehradun","Haridwar","Nainital","Pauri Garhwal","Pithoragarh","Rudra Prayag","Tehri Garhwal","Udam Singh Nagar","Uttar Kashi"),
        "WEST BENGAL" to listOf("24 Paraganas North","24 Paraganas South","Alipurduar","Bankura","Birbhum","Coochbehar","Darjeeling","Dinajpur Dakshin","Dinajpur Uttar","Hooghly","Howrah","Jalpaiguri","Jhargram","Kalimpong","Kolkata","Maldah","Medinipur East","Medinipur West","Murshidabad","Nadia","Paschim Bardhaman","Purba Bardhaman","Purulia")
    )

    private val RULE_LABELS = listOf("Universal", "Office", "State", "District")
    private val RULE_KEYS   = listOf("universal", "office", "state", "district")

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return inflater.inflate(R.layout.fragment_geofence_admin, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        llList      = view.findViewById(R.id.llList)
        tvEmpty     = view.findViewById(R.id.tvEmpty)
        pbLoading   = view.findViewById(R.id.pbLoading)
        etSearch    = view.findViewById(R.id.etSearch)
        spinnerRule = view.findViewById(R.id.spinnerRule)

        spinnerRule.adapter = ArrayAdapter(
            requireContext(),
            android.R.layout.simple_spinner_item,
            listOf("All rules", "Office", "Universal", "State", "District")
        ).also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }

        etSearch.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) = applyFilter()
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) {}
        })

        spinnerRule.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                currentRuleFilter = when (pos) {
                    1 -> "office"; 2 -> "universal"; 3 -> "state"; 4 -> "district"; else -> "all"
                }
                applyFilter()
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        loadData()
    }

    private fun loadData() {
        lifecycleScope.launch {
            try {
                pbLoading.visibility = View.VISIBLE
                llList.removeAllViews()
                tvEmpty.visibility = View.GONE

                val locRes = RetrofitClient.instance.getGeofenceLocations()
                val empRes = RetrofitClient.instance.getAllBufferRules()

                if (locRes.isSuccessful) locations = locRes.body()?.data ?: emptyList()
                if (empRes.isSuccessful) allEmployees = empRes.body()?.data ?: emptyList()

                pbLoading.visibility = View.GONE
                applyFilter()
            } catch (e: Exception) {
                pbLoading.visibility = View.GONE
                Toast.makeText(requireContext(), "Failed to load: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun applyFilter() {
        val q = etSearch.text.toString().trim().lowercase()
        val filtered = allEmployees.filter { emp ->
            val matchSearch = q.isEmpty()
                    || emp.fullName.lowercase().contains(q)
                    || emp.employeeCode?.lowercase()?.contains(q) == true
            val matchRule = currentRuleFilter == "all"
                    || emp.currentRule.lowercase() == currentRuleFilter
            matchSearch && matchRule
        }
        renderList(filtered)
    }

    // ── Compact card list — no inline editors ────────────────────────────────
    private fun renderList(list: List<GeofenceEmployeeRow>) {
        val ctx = requireContext()
        llList.removeAllViews()

        if (list.isEmpty()) {
            tvEmpty.visibility = View.VISIBLE
            return
        }
        tvEmpty.visibility = View.GONE

        list.forEach { emp ->
            val itemView = LayoutInflater.from(ctx).inflate(R.layout.item_geofence_employee, llList, false)

            val tvInitials   = itemView.findViewById<TextView>(R.id.tvInitials)
            val tvName       = itemView.findViewById<TextView>(R.id.tvName)
            val tvRuleBadge  = itemView.findViewById<TextView>(R.id.tvRuleBadge)
            val tvSubtitle   = itemView.findViewById<TextView>(R.id.tvSubtitle)

            // Avatar initials
            val initials = emp.fullName.split(" ")
                .mapNotNull { it.firstOrNull()?.uppercaseChar() }
                .take(2).joinToString("")
            tvInitials.text = initials.ifBlank { "?" }

            tvName.text = emp.fullName

            // Subtitle: "KC8989 • Anywhere"
            val codeStr = emp.employeeCode?.ifBlank { null }
            tvSubtitle.text = listOfNotNull(codeStr, emp.assignment).joinToString(" • ")

            // Badge
            val (textColor, bgDrawable) = ruleBadgeStyle(emp.currentRule)
            tvRuleBadge.text = emp.currentRule.replaceFirstChar { it.uppercase() }
            tvRuleBadge.setTextColor(android.graphics.Color.parseColor(textColor))
            tvRuleBadge.setBackgroundResource(bgDrawable)

            // Tap entire card → open edit bottom sheet
            itemView.setOnClickListener { showEditSheet(emp) }

            llList.addView(itemView)
        }
    }

    // ── Progressive edit bottom sheet ────────────────────────────────────────
    private fun showEditSheet(emp: GeofenceEmployeeRow) {
        val ctx = requireContext()
        val dialog = BottomSheetDialog(ctx)
        val sheetView = LayoutInflater.from(ctx).inflate(R.layout.bottom_sheet_edit_employee_rule, null)
        dialog.setContentView(sheetView)

        // Header
        val bsInitials  = sheetView.findViewById<TextView>(R.id.bsInitials)
        val bsName      = sheetView.findViewById<TextView>(R.id.bsName)
        val bsCode      = sheetView.findViewById<TextView>(R.id.bsCode)
        val bsRuleBadge = sheetView.findViewById<TextView>(R.id.bsRuleBadge)

        val initials = emp.fullName.split(" ")
            .mapNotNull { it.firstOrNull()?.uppercaseChar() }.take(2).joinToString("")
        bsInitials.text = initials.ifBlank { "?" }
        bsName.text = emp.fullName
        bsCode.text = emp.employeeCode ?: ""

        val (textColor, bgDrawable) = ruleBadgeStyle(emp.currentRule)
        bsRuleBadge.text = emp.currentRule.replaceFirstChar { it.uppercase() }
        bsRuleBadge.setTextColor(android.graphics.Color.parseColor(textColor))
        bsRuleBadge.setBackgroundResource(bgDrawable)

        // Pickers
        val bsSpRule     = sheetView.findViewById<Spinner>(R.id.bsSpRule)
        val bsLlLocation = sheetView.findViewById<LinearLayout>(R.id.bsLlLocation)
        val bsSpLocation = sheetView.findViewById<Spinner>(R.id.bsSpLocation)
        val bsLlState    = sheetView.findViewById<LinearLayout>(R.id.bsLlState)
        val bsSpState    = sheetView.findViewById<Spinner>(R.id.bsSpState)
        val bsLlDistrict = sheetView.findViewById<LinearLayout>(R.id.bsLlDistrict)
        val bsSpDistrict = sheetView.findViewById<Spinner>(R.id.bsSpDistrict)
        val bsBtnApply   = sheetView.findViewById<Button>(R.id.bsBtnApply)

        // Rule spinner
        bsSpRule.adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_item, RULE_LABELS)
            .also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        val initialRulePos = RULE_KEYS.indexOf(emp.currentRule.lowercase()).takeIf { it >= 0 } ?: 0
        bsSpRule.setSelection(initialRulePos)

        // Office spinner
        bsSpLocation.adapter = ArrayAdapter(ctx, android.R.layout.simple_spinner_item, locations.map { it.name })
            .also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
        emp.officeLocationId?.let { lid ->
            locations.indexOfFirst { it.id == lid }.takeIf { it >= 0 }?.let { bsSpLocation.setSelection(it) }
        }

        // State spinner
        bsSpState.adapter = hintSpinnerAdapter(ctx, "— select state —", BR_STATES)
        val existingStateIdx = if (!emp.state.isNullOrBlank()) BR_STATES.indexOf(emp.state) else -1
        if (existingStateIdx >= 0) bsSpState.setSelection(existingStateIdx + 1)

        // District helper
        fun populateDistricts(selectedState: String, preSelectDistrict: String? = null) {
            val districts = BR_DISTRICTS[selectedState] ?: emptyList()
            bsSpDistrict.adapter = hintSpinnerAdapter(ctx, "— select district —", districts)
            if (!preSelectDistrict.isNullOrBlank()) {
                val idx = districts.indexOfFirst { it.equals(preSelectDistrict, ignoreCase = true) }
                if (idx >= 0) bsSpDistrict.setSelection(idx + 1)
            }
        }
        if (!emp.state.isNullOrBlank()) populateDistricts(emp.state, emp.district)

        // Set initial row visibility before attaching listeners
        fun updateVisibility(ruleKey: String, stateChosen: Boolean = bsSpState.selectedItemPosition > 0) {
            bsLlLocation.visibility = if (ruleKey == "office") View.VISIBLE else View.GONE
            bsLlState.visibility    = if (ruleKey == "state" || ruleKey == "district") View.VISIBLE else View.GONE
            bsLlDistrict.visibility = if (ruleKey == "district" && stateChosen) View.VISIBLE else View.GONE
        }
        updateVisibility(RULE_KEYS[initialRulePos], existingStateIdx >= 0)

        // Listeners — suppress initial fire
        var isInitializing = true
        bsSpRule.post { isInitializing = false }

        bsSpRule.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                if (isInitializing) return
                updateVisibility(RULE_KEYS[pos])
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        bsSpState.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, v: View?, pos: Int, id: Long) {
                if (pos == 0) { bsLlDistrict.visibility = View.GONE; return }
                val selectedState = BR_STATES[pos - 1]
                populateDistricts(selectedState)
                val currentRuleKey = RULE_KEYS[bsSpRule.selectedItemPosition]
                bsLlDistrict.visibility = if (currentRuleKey == "district") View.VISIBLE else View.GONE
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        // Apply
        bsBtnApply.setOnClickListener {
            val ruleKey = RULE_KEYS[bsSpRule.selectedItemPosition]
            if ((ruleKey == "state" || ruleKey == "district") && bsSpState.selectedItemPosition == 0) {
                Toast.makeText(ctx, "Please select a state", Toast.LENGTH_SHORT).show(); return@setOnClickListener
            }
            if (ruleKey == "district" && bsSpDistrict.selectedItemPosition == 0) {
                Toast.makeText(ctx, "Please select a district", Toast.LENGTH_SHORT).show(); return@setOnClickListener
            }

            val selectedState = if (bsSpState.selectedItemPosition > 0) BR_STATES[bsSpState.selectedItemPosition - 1] else null
            val districtList  = if (selectedState != null) BR_DISTRICTS[selectedState] ?: emptyList() else emptyList()
            val selectedDistrict = if (bsSpDistrict.selectedItemPosition > 0) districtList.getOrNull(bsSpDistrict.selectedItemPosition - 1) else null
            val officeLocId   = if (ruleKey == "office") locations.getOrNull(bsSpLocation.selectedItemPosition)?.id else null

            saveRule(
                emp      = emp,
                ruleKey  = ruleKey,
                locationId = officeLocId,
                state    = if (ruleKey == "state" || ruleKey == "district") selectedState else null,
                district = if (ruleKey == "district") selectedDistrict else null,
                btn      = bsBtnApply,
                onSuccess = { dialog.dismiss() }
            )
        }

        dialog.show()
    }

    private fun saveRule(
        emp: GeofenceEmployeeRow,
        ruleKey: String,
        locationId: Int?,
        state: String?,
        district: String?,
        btn: Button,
        onSuccess: () -> Unit
    ) {
        lifecycleScope.launch {
            try {
                btn.isEnabled = false
                btn.text = "Saving…"

                val body = mutableMapOf<String, Any?>("employee_id" to emp.id, "rule_type" to ruleKey)
                if (ruleKey == "state" || ruleKey == "district") {
                    body["state"]    = state
                    body["district"] = if (ruleKey == "district") district else null
                }
                if (ruleKey == "office") locationId?.let { body["office_location_id"] = it }

                val res = RetrofitClient.instance.saveGeofenceRule(body)
                if (res.isSuccessful) {
                    Toast.makeText(requireContext(), "Rule updated for ${emp.fullName}", Toast.LENGTH_SHORT).show()
                    onSuccess()
                    loadData()
                } else {
                    Toast.makeText(requireContext(), "Failed to update rule", Toast.LENGTH_SHORT).show()
                    btn.isEnabled = true
                    btn.text = "Save changes"
                }
            } catch (e: Exception) {
                Toast.makeText(requireContext(), "Error: ${e.message}", Toast.LENGTH_SHORT).show()
                btn.isEnabled = true
                btn.text = "Save changes"
            }
        }
    }

    private fun ruleBadgeStyle(rule: String): Pair<String, Int> = when (rule.lowercase()) {
        "office"   -> Pair("#1565C0", R.drawable.bg_badge_office)
        "state"    -> Pair("#6a1b9a", R.drawable.bg_badge_state)
        "district" -> Pair("#e65100", R.drawable.bg_badge_district)
        else       -> Pair("#2e7d32", R.drawable.bg_badge_universal)
    }

    private fun hintSpinnerAdapter(
        ctx: android.content.Context,
        hint: String,
        items: List<String>
    ): ArrayAdapter<String> {
        val all = listOf(hint) + items
        return object : ArrayAdapter<String>(ctx, android.R.layout.simple_spinner_item, all) {
            override fun isEnabled(position: Int) = position != 0
            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getDropDownView(position, convertView, parent) as TextView
                view.setTextColor(if (position == 0) android.graphics.Color.parseColor("#AAAAAA") else android.graphics.Color.parseColor("#212121"))
                return view
            }
            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                val view = super.getView(position, convertView, parent) as TextView
                view.setTextColor(if (position == 0) android.graphics.Color.parseColor("#AAAAAA") else android.graphics.Color.parseColor("#212121"))
                return view
            }
        }.also { it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item) }
    }
}