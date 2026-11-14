// auth.js
import { db } from '../conf/fb_conf.js';
import { collection, query, where, getDocs, updateDoc, doc, addDoc } from 'firebase/firestore/lite'; 
import { gptStartPage } from '../data/gptStartPage.js';
import { ConfigManager } from '../main/utils/ConfigManager.js'; // 🟢 PRO FIX: Import must be at the top!

export async function loginUser(gmail, token) {
  console.log('LOGINUSER ___________]');
  try {
    const usersRef = collection(db, 'users'); 
    const q = query(usersRef, where('emails', 'array-contains', gmail)); 
    const usersSnapshot = await getDocs(q); 

    if (usersSnapshot.empty) {
      window.toast('User not found.');
      return null;
    }

    for (const docSnap of usersSnapshot.docs) {
      const userData = docSnap.data();

      if (userData.token === token) {
        if (userData.isLogin) {
          window.toast('User already logged in.');
          return null;
        } else {
          const userDocRef = doc(db, 'users', docSnap.id); 
          await updateDoc(userDocRef, {
            isLogin: true,
            current_email: gmail
          });

          ConfigManager.set('current-gpt-user-email', gmail);
          ConfigManager.set('current-gpt-user-name', userData.name);
          ConfigManager.set('current-gpt-user-isBlock', userData.isBlock);
          
          if (ConfigManager.get('saved-email') === null) {
            ConfigManager.set('saved-email', gmail);
          }

          ConfigManager.set('gpt-token', token);
          ConfigManager.set('gpt-user-id', docSnap.id);

          window.toast('Login successful');
          return gmail; 
        }
      } else {
        window.toast('Invalid security token.');
        return null;
      }
    }
  } catch (error) {
    window.toast('Error during login:');
    return null;
  }
}

export async function isBlock(gmail) {
  console.log('ISBLOCK ___________]');
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('emails', 'array-contains', gmail));
    const usersSnapshot = await getDocs(q);

    if (usersSnapshot.empty) {
      console.warn('User not found.');
      return null;
    }

    let result = null;

    for (const docSnap of usersSnapshot.docs) {
      const userData = docSnap.data();

      if (userData) {
        ConfigManager.set('current-gpt-user-isBlock', userData.isBlock);
        result = {
          primary_info: userData.primary_info || '',
          secondary_info: userData.secondary_info || ''
        };
      }
    }
    return result;
  } catch (error) {
    console.error('Error during isBlock check:', error.message);
    window.toast('Offline or server error. Please try again later.');
    return null;
  }
}

export async function logoutUser() {
  // 🟢 PRO FIX: Dynamically fetch userEmail to prevent hoisting bugs
  const userEmail = ConfigManager.get('current-gpt-user-email'); 
  if (!userEmail) {
    window.toast('No user is currently logged in.');
    return;
  }
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('emails', 'array-contains', userEmail)); 
    const usersSnapshot = await getDocs(q);

    if (usersSnapshot.empty) {
      window.toast('User not found.');
      return;
    }

    usersSnapshot.forEach(async (docSnap) => {
      const userDocRef = doc(db, 'users', docSnap.id); 
      await updateDoc(userDocRef, { isLogin: false });
      window.toast('User logged out successfully.');
    });

    ConfigManager.remove('current-gpt-user-email');
    ConfigManager.remove('current-gpt-user-name');
    ConfigManager.remove('current-gpt-user-isBlock');
    ConfigManager.remove('gpt-token');
}

export async function checkTokenStatus(savedToken, email) {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('current_email', '==', email));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) return;

    let tokenMatched = false;
    querySnapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.token === savedToken) {
        tokenMatched = true;
      } else {
        window.toast("Already Logged In Another Device.");
        tokenMatched = 'logout';
      }
    });
    
    if(tokenMatched == 'logout') return 'logout';
    return tokenMatched ? true : false;
  } catch (error) {
    console.error('Error checking token:', error);
  }
}

export const submitFeedToServer = (feedbackData) =>{
  const feedbackRef = collection(db, 'feedback'); 
  addDoc(feedbackRef, feedbackData)
    .then(() => { window.toast("Thanks for your feedback"); })
    .catch((error) => { window.toast("Feedback Failed"); });
}

export function renderRandomInfoSection(infoData) {
  if(!infoData) return [];
  
  let infoContainer = document.querySelector('.gpt-info');
  let chatBox = document.getElementById('chat-box');
  
  if(!infoContainer && chatBox){
    chatBox.innerHTML = gptStartPage;
    infoContainer = document.querySelector('.gpt-info'); 
  }
  
  if(!infoContainer) return infoData; 
  infoContainer.innerHTML = ''; 

  const sortedData = infoData.sort((a, b) => (a.function === 'none' ? -1 : 1));
  const randomItems = sortedData.slice().sort(() => 0.5 - Math.random()).slice(0, 4);

  randomItems.forEach(info => {
    const infoDiv = document.createElement('div');
    infoDiv.classList.add('gpt-info-list');
    infoDiv.style = 'min-width:auto;height:60px;background-color:#e1dcdc9d;border-radius:8px;text-align:center;line-height:1.5;display:flex;justify-content:center;align-items:center;flex-direction:column;padding:5px;flex-grow:1;flex-shrink:0;';

    const title = document.createElement('p');
    title.classList.add('bottom-info-heading');
    title.style = 'font-size:1.1em;font-weight:400;';
    title.textContent = info.title;

    const content = document.createElement('p');
    content.classList.add('bottom-info-title');
    content.style = 'font-size:0.9em;color:#4d4d4d;';
    content.textContent = info.content;

    infoDiv.appendChild(title);
    infoDiv.appendChild(content);

    infoDiv.setAttribute('data-function-type', info.function);
    infoDiv.setAttribute('data-title', info.title);
    infoDiv.setAttribute('data-content', info.content);

    if (info.function === 'none') {
      infoDiv.style.pointerEvents = 'none';
      infoDiv.style.opacity = '0.6'; 
    } else {
      infoDiv.style.cursor = 'pointer';
    }

    infoContainer.appendChild(infoDiv);
  });

  return infoData;
}