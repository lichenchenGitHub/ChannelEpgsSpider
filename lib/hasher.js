var crypto = require('crypto');

function Hasher() {

}

Hasher.prototype.constructor = Hasher;

Hasher.GetSHA1 = function (msg) {
    var hash = crypto.createHash('sha1');
    hash.update(msg);
    return hash.digest('hex');
}

Hasher.GetMD5 = function (msg) {
    var hash = crypto.createHash('md5');
    hash.update(msg);
    return hash.digest('hex');
}

module.exports = Hasher;