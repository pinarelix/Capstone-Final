// Canonical list of valid incident/patrol locations for Barangay 179 —
// shared across incident.html and patrol.html so both pages offer (and
// the server enforces) the same set of location values. Follows the
// same plain-script-global pattern as mapHelper.js.
//
// Kept in sync by hand with backend/locationList.js (same values) —
// this codebase has no bundler/build step to share one file between
// frontend and backend, and the list is short and rarely changes.
const BARANGAY_LOCATIONS = [
    'Acacia Street', 'Aguho Street', 'Alibangbang Street', 'Amugis Street', 'Anahaw Street',
    'Anapla Street', 'Annunciation Street', 'Anonas Street', 'Antipolo Street', 'Anubing Street',
    'Ascencion Street', 'Assumption Street',
    'Bagtikan Street', 'Balimbing Street', 'Balite Street', 'Balubad Street', 'Banaba Street',
    'Bangkal Street', 'Bayabas Street', 'Bigaa Street', 'Binayuyo Street', 'Bitao Street',
    'C. M. Hoskins Street', 'Dao Street', 'Dapdap Street',
    'Duhat Street', 'Guagua Street', 'H. Dela Costa Avenue', 'Iloilo Street', 'Jaro Street',
    'Kalinga Street', 'Kamias Street', 'Kamuning Street', 'Kaong Street', 'Katmon Street',
    'Kawayan Street', 'Kaymito Street', 'Kupang Street', 'Lawaan Street',
    'Lukban Street', 'Mabolo Street', 'Macabud Street', 'Malanting Street', 'Mandaue Street',
    'Mangga Street', 'Maraluhat Street', 'Marang Street', 'Mary the Queen Street',
    'Mulawin Street', 'Nativity Street', 'Ormoc Street',
    'Pentecost Street', 'Pili Street',
    'Resurrection Street', 'Rimas Street', 'Roxas Street',
    'Saint Andrew Street', 'Saint Bartholomew Street', 'Saint George Street', 'Saint Ignatius Street',
    'Saint John Street', 'Saint Matthew Street', 'Saint Peter Street',
    'Sampaloc Street', 'Santol Street', 'Saplungan Street',
    'Tibeg Street', 'Tindalo Street',
    'Wawa Street', 'Xavier Street', 'Zambales Street'
];
