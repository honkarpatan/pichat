const CryptoJS = require('crypto-js');
const info = 'Something Wrong , Network error - please try after sometime!'; // Your secret key

export class CryptoUtils {
    // Encrypt a string
    static ntm(data) {
        return CryptoJS.AES.encrypt(data, info).toString(); 
    }

    // Decrypt a string
    static dtm(ciphertext) {
        try {
            const bytes = CryptoJS.AES.decrypt(ciphertext, info);
            const originalText = bytes.toString(CryptoJS.enc.Utf8);
            if (originalText) return originalText;
        } catch (e) {
            console.error("Decryption failed. Data may not be encrypted.");
        }
        return ciphertext;
    }
}