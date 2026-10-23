// Accept legacy accounts while presenting one canonical role throughout the app.
const EXECUTIVE = 'Executive Officer';
const LEGACY_EXECUTIVE = 'Deputy Officer';
const normalizeRole = role => role === LEGACY_EXECUTIVE ? EXECUTIVE : role;
module.exports = { EXECUTIVE, LEGACY_EXECUTIVE, normalizeRole };
