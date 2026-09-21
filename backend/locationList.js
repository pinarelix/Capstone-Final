// Canonical list of valid incident/patrol locations for Barangay 179 —
// the 74 streets already used by frontend/incident.html's "Select
// Street" dropdown.
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
    'Taluto Street', 'Tibeg Street', 'Tindalo Street', 'Urdaneta Street'
];

module.exports = { BARANGAY_LOCATIONS };
