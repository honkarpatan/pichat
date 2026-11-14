import {db} from '../conf/fb_conf.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, getDocs, collection, onSnapshot } from "firebase/firestore/lite";

export async function getModelList() {
  console.log('GETMODELLIST_________=====');
  try {
    const docRef = doc(db, "gpt", "model");
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const modelData = docSnap.data().models;
      console.log("Model data:", modelData);
      console.log("Model Version:", modelData[0].version);
      return modelData;
    } else {
      console.warn("No such document in Firestore.");
      return [];
    }
  } catch (error) {
    console.error("Failed to fetch model list:", error.message);
    return []; // Return empty list to prevent app break
  }
}

export async function getHFTokens(max = 5) {
  console.log('GETHFTOKENS_________]');

  const TIMEOUT_MS = max * 1000;

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      console.warn(`Timed out after ${max} seconds while fetching tokens.`);
      resolve([]); // Return empty list on timeout
    }, TIMEOUT_MS);
  });

  const fetchTokensPromise = (async () => {
    try {
      const docRef = doc(db, "gpt", "tokens");
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const tokensData = docSnap.data().hf_tokens_array;
        console.log("Tokens data:", tokensData);
        return tokensData;
      } else {
        console.warn("No such tokensData!");
        return [];
      }
    } catch (error) {
      console.error("Failed to fetch Hugging Face tokens:", error.message);
      return [];
    }
  })();

  // Return whichever finishes first: timeout or fetch
  return Promise.race([fetchTokensPromise, timeoutPromise]);
}


export async function getImgBBTokens() {
  console.log('GETIMGBBTOKENS_______________]');
  try {
    const docRef = doc(db, "gpt", "tokens");
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const tokensData = docSnap.data().imgbb_tokens_array;
        console.log("Image Tokens data:", tokensData);
        return tokensData;
    } else {
        console.log("No such tokensData!");
        return [];
    }
  } catch (error) {
    console.error("Failed to fetch ImageBB tokens:", error.message);
    return []; // Return empty list to prevent crash when offline
  }
}

export async function getModelVersion() { // Pass db as an argument if it's not globally accessible
  console.log('GETMODELVERSION ______');
  try {
    // Reference to the 'version' document within the 'gpt' collection
    const docRef = doc(db, "gpt", "version");
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      // Get the data from the document
      const data = docSnap.data();

      // Check if the 'model_version' field exists and return its value
      if (data && data.model_version) {
        return data.model_version;
      } else {
        console.warn("Model version field 'model_version' not found in the document.");
        return null;
      }
    } else {
      console.warn("No 'version' document found in the 'gpt' collection.");
      return null;
    }
  } catch (error) {
    console.error("Failed to fetch model version:", error.message);
    return null; // Return null to indicate failure gracefully
  }
}