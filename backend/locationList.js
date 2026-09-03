// Canonical list of valid incident/patrol locations for Barangay 179 —
// the 74 streets already used by frontend/incident.html's "Select
// Street" dropdown, plus the broader area/purok names patrol schedules
// legitimately use instead of one exact street (a patrol can cover
// "Purok 1-3" as a whole, not just a single named street).
//
// Kept in sync by hand with frontend/locationList.js (same values) —
// this codebase has no bundler/build step to share one file between
// frontend and backend, and the list is short and rarely changes.
const BARANGAY_LOCATIONS = [
    'Acacia Street', 'Aguho Street', 'Akle Street', 'Alibangbang Street', 'Almasiga Street',
    'Amparo Main Road', 'Amparo Subdivision Main Road', 'Amugis Street', 'Anahaw Street',
    'Anapla Street', 'Anonas Street', 'Antipolo Street', 'Anubing Street', 'Arit Street',
    'Bagtikan Street', 'Balimbing Street', 'Balite Street', 'Balubad Street', 'Banaba Street',
    'Bangkal Street', 'Bayabas Street', 'Bigaa Street', 'Binayuyo Street', 'Bulak Street',
    'Carnation Street', 'Crispulo Street', 'Dahlia Extension', 'Dao Street', 'Dapdap Street',
    'Duhat Street', 'H. Dela Costa Avenue', 'Ipil Street', 'Kakawate Street', 'Kalantas Street',
    'Kamachile Street', 'Kamias Street', 'Kamuning Street', 'Kaong Street', 'Katmon Street',
    'Katuray Street', 'Kawayan Street', 'Kaymito Street', 'Kupang Street', 'Lanite Street',
    'Lanzones Street', 'Lawaan Street', 'Lukban Street', 'Mabolo Street', 'Macabud Street',
    'Malanting Street', 'Mangga Street', 'Maraluhat Street', 'Marang Street', 'Market Area',
    'Mayapis Street', 'Mulawin Street', 'Narra Street', 'Palosapis Street', 'Papaya Street',
    'Pili Street', 'Rimas Street', 'Riverside Street', 'Sampaguita Street', 'Sampaloc Street',
    'Santol Street', 'Saplungan Street', 'Sitao Street', 'Sta. Maria Street', 'Talisay Street',
    'Taluto Street', 'Tibeg Street', 'Tindalo Street', 'Urdaneta Street',
    // Broader areas/puroks (not individual streets) — legitimate patrol_schedules.location
    // values that predate this list, per the original Tanod assigned-area dropdown.
    'Purok 1-3', 'Purok 4-6', 'All Areas',
    // Already in real use by existing patrol schedules but not otherwise on this list —
    // included so editing those schedules doesn't get blocked by this new validation.
    'Ananapia', 'Sulasok'
];

module.exports = { BARANGAY_LOCATIONS };
