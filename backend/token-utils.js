const crypto = require('crypto');

function hashToken(token) {
    return crypto
        .createHash('sha256')
        .update(token, 'utf8')
        .digest('hex');
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateResetToken() {
    return crypto.randomBytes(32).toString('base64url');
}

module.exports = { hashToken, generateSessionToken, generateResetToken };
