function simplifyCode(code) {
    // Remove the bodies of child functions and replace them with placeholders
    return code
        // Remove comments
        .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
        // Simplify constructor or function variables
        .replace(/(let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*.*?;/g, '$2:var')
        // Simplify if conditions
        .replace(/if\s*\((.*?)\)\s*\{[\s\S]*?\}/g, 'if ($1) {...}')
        // Simplify function bodies
        .replace(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([\s\S]*?\)\s*\{[\s\S]*?\}/g, 'function $1() {...}')
        // Simplify class methods or function declarations
        .replace(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([\s\S]*?\)\s*\{[\s\S]*?\}/g, '$1() {...}')
        // Simplify constructor bodies
        .replace(/constructor\s*\([\s\S]*?\)\s*\{[\s\S]*?\}/g, 'constructor() {...}');
}


export function getFunctionSignatureFromString(input, maxLength) {
  // Step 1: Use regex to capture both outer and inner functions
  // This regex will match 'function', 'class', 'async function' and also handle nested functions
  const functionRegex = /((async\s+)?function[\s\S]*?{[\s\S]*?})/g;
  const classRegex = /(class[\s\S]*?{[\s\S]*?})/g;
  
  // Match both function and class definitions
  let functionsAndClasses = input.match(functionRegex) || [];
  let classes = input.match(classRegex) || [];
  
  // Combine matched functions and classes
  let signatures = [...functionsAndClasses, ...classes];
  
  let result = '';
  let totalLength = 0;
  
  // Step 2: Process each signature, replacing outer function bodies but preserving child functions
  for (let i = 0; i < signatures.length; i++) {
    // Preserve inner functions by replacing only the outermost body of the function
    const fnSignature = signatures[i].replace(/({[\s\S]*})/, '{ /* ...child functions... */ }') + '\n';

    const projectedLength = totalLength + fnSignature.length;

    // If adding this function exceeds maxLength, truncate
    if (projectedLength > maxLength) {
      if (totalLength === 0) {
        result += fnSignature.slice(0, maxLength - 3) + '...'; // Crop if the first function itself is too large
      } else {
        result = result.trim() + '...'; // Otherwise, stop and add ellipsis
      }
      break;
    }

    // Add function signature to the result
    result += fnSignature;
    totalLength += fnSignature.length;
  }
if(result.length < maxLength){
  let res = simplifyCode(input);
  console.log('res ==>', res);
}
  return result.trim(); // Return the final string
}

// Test input with inner/child functions
// let inputString = `handleSendMessage(isResend = null) {
//   console.log('HANDLESENDMESSAGE -------------]');
// this.setActiveChat(parseInt(this.currentConversationIndex));
// if(this.pathUrl !== 'null' && this.selectedModel.type !== 'texttoimage'){
//   this.loadConversation(parseInt(this.currentConversationIndex));
//   this.loadConversationTemp(parseInt(this.currentConversationIndex));
// }
// let currentTokenUsage = localStorage.getItem('gpt-token-usage');


// let botMessageElementWeb = null;
// this.web_results = '';
// let userInput;
// if (isResend === null){
// userInput = document.getElementById('user-input').value.trim();
// document.getElementById('user-input').value = '';
// fixInputHeight();
// } else {
// userInput = isResend;
// }
// if (userInput === '') return;


// if (userInput == '@remove token'){
// localStorage.setItem('gpt-token-usage', '0');
// return;
// } else if (userInput == '@4 token'){
// localStorage.setItem('gpt-token-usage', '4.5');
// return;
// } else if (userInput == '@remove lastdate'){
// // localStorage.removeItem('gpt-usage-limit', 0);
// localStorage.removeItem('gpt-last-update-date');
// return;
// }else if (userInput == '@remove path'){
// // localStorage.removeItem('gpt-usage-limit', 0);
// localStorage.removeItem('selectedPath');
// localStorage.removeItem('current_chat_index');
// localStorage.removeItem('continueWOpath');
// return;
// }


// // console.log('before RENDER',this.chatHistory);
// await this.addMessageToHistory('user', userInput.trim());
// const need_web_search = await needWebSearch(userInput);
// if (need_web_search && this.isUserBlock == false){
// await this.updateAssistantMessage(true , 'Searching web...');
// this.web_results = await displayResults(userInput.startsWith('@') ? userInput.replace('@', ''): userInput, 400, 800, 4000);

// await this.addMessageToHistoryTemp('user', '
// user: {userInput}, [current_date: {getCurrentDate()}  web_results : {this.web_results}]
// '
// );
// } else {
  
// await this.addMessageToHistoryTemp('user', userInput);
// // console.log('this.conversationsTemp$$$$$$$$$$$$$--',this.conversationsTemp);
// }

// // console.log('web need',need_web_search);
// if(this.selectedModel.type !== 'texttoimage'){
// this.renderChat(this.chatHistory);
// }
// // document.getElementById('user-input').value = '';





// // console.log('after RENDER',this.chatHistory);
// console.log(' this.continueWOpath', this.continueWOpath);
// console.log(' this.pathUrl', this.pathUrl);
// if(this.pathUrl === 'null' && this.continueWOpath === 'false'){
//   console.log('xxx_1111111111111111111111111111111');
//   let primaryInfo = 'To save your chat history, please add a storage directory. Without it, conversations will not be saved.';
//   let secondaryInfo = 'go to Acode Plugin setting & add path <span style="color:#2038c1;">OR</span> <span id="gpt-add-directory">click here </span><br><span style="color:#2038c1;">OR</span> 
//   <span id="gpt-ignore-directory"> Continue with Temporary Chat </span>';
//   let block_status = 270 ;
  
// await this.addMessageToHistory('assistant', '@@@!!! style="color:#ff9611;">{primaryInfo}
// >- {secondaryInfo}>
// - n style="color:#f11;"status : span style="color:#f11;">{block_status}span', null);

// await this.addMessageToHistoryTemp('assistant', '@@@!!!{primaryInfo}', null);

// const gptAddDirectory =document.getElementById('gpt-add-directory');
//   gptAddDirectory.addEventListener('click',()=>{
//     console.log('clicking');
//     this.setPath();
//   });
  
// const gptIgnoreDirectory =document.getElementById('gpt-ignore-directory');
//   gptIgnoreDirectory.addEventListener('click',async ()=>{
// const userMessage = document.querySelector(.message.user-message:nth-child({1})');
//     localStorage.setItem('continueWOpath','true');
//     this.continueWOpath = 'true' ;
    
//     console.log('userMessage',userMessage);
//     await this.deleteMessage(parseInt(this.currentConversationIndex));
//     this.handleSendMessage(userMessage.innerText);
//   });
// }else if (this.block_status){
//   console.log('xxx_2222222222222222222222222222222');
// await this.addMessageToHistory('assistant', @@@!!!this.primaryInfo - <span style="color:#f11;">status</span> : <span style="color:#f11;">{this.block_status}</span><br> - {this.secondaryInfo}, null);
// await this.addMessageToHistoryTemp('assistant', @@@!!! {this.secondaryInfo}, null);
// } else if (this.userPremium || parseFloat(currentTokenUsage) <= parseFloat(this.usage_limit)){
//   console.log('xxx_333333333333333333333333333');
//   console.log('sendMessageToApi -- userInput',userInput);
// await this.sendMessageToApi(userInput, need_web_search);
// } else if (parseFloat(currentTokenUsage) >= parseFloat(this.usage_limit)){
//   console.log('xxx_444444444444444444444444444444444');
//   console.log('parseFloat(currentTokenUsage)',parseFloat(currentTokenUsage));
//   console.log('parseFloat(this.usage_limit)',parseFloat(this.usage_limit));
  
// // this.primaryInfo = 
// // this.secondaryInfo = ;
// await this.addMessageToHistory('assistant',@@@***<div style="color:#a78;font-weight:500;">
//     insufficient_quota - You exceeded your current quota, please check your plan and billing details.
//   </div> 
//   - <span style="color:#f11;">status</span> : 
//   <span style="color:#f11;">{429}</span><br>
//   - <p>OR</p>
//   <span>Contact</span> <a href="https://t.me/cosmodec" style="color:#06c;text-decoration:underline;">here</a>);
// await this.addMessageToHistoryTemp('assistant', insufficient_quota - You exceeded your current quota, please check your plan and billing details - 429<br>);

// this.updateTokenUsage('a');
// console.log('Over used');
// }else{
//   console.log('xxx_55555555555555555555555');
// }
// } ` ;

// Test the function with a maxLength of 400 characters
// const result = getFunctionSignatureFromString(inputString, 4000);
// console.log(result);