const CryptoJS = require('crypto-js');

// Define a secret key for encryption/decryption
const SECRET_KEY = 'Something Wrong , Network error - please try after sometime!';

export class CryptoHelper {
    // Encrypt a string
    static ntm(data) {
        return CryptoJS.AES.encrypt(data, SECRET_KEY).toString();
    }

    // Decrypt a string
    static dtm(ciphertext) {
        try {
            const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
            const originalText = bytes.toString(CryptoJS.enc.Utf8);
            
            // If decryption worked, return the original text
            if (originalText) return originalText;
        } catch (e) {
            console.error("Decryption failed. Data may not be encrypted.");
        }
        
        // If decryption fails, return the original text assuming it's plaintext
        return ciphertext;
    }
}