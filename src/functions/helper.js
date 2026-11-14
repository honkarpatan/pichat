import Path from '../data/path';

export function getCurrentDate(){
const today = new Date();
const formattedDate = ("0" + (today.getMonth() + 1)).slice(-2) + "/" + 
                      ("0" + today.getDate()).slice(-2) + "/" + 
                      today.getFullYear();
return formattedDate;

}

export function addExtraPrompt(data,text,role='user'){
  // Extended chatHistory array with multiple conversations
  let d = data;
  // Find the last item with role 'user' and append text to its content
  for (let i = d.length - 1; i >= 0; i--) {
    if (d[i].role === role) {
      d[i].content += text;
      break ;
    }
  }
  return d ;
}

export function addExtraPromptDate(data, text, role = 'user') {
  // Iterate over the data from the last item to the first
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].role === role) {
      // Update the content of the last 'user' role
      data[i].content += ` ,today: ${getCurrentDate()} ,# ${text}`;
      break; // Stop after finding and updating the last user message
    }
  }
  
  // Return the updated array
  return data;
}


export function addExtraPrompt_Websearch(data, text, role = 'user') {
  // Iterate over the data from the last item to the first
  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i].role === role) {
      // Update the content of the last 'user' role
      data[i].content += ` ,today: ${getCurrentDate()} ,web_result: ${text}`;
      break; // Stop after finding and updating the last user message
    }
  }
  
  // Return the updated array
  return data;
}


export function addCopyButton(container , index) {
    const codeBlocks = container.querySelectorAll('pre code');
    codeBlocks.forEach((codeBlock) => {
        // Create copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-btn';
        copyButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-clipboard" viewBox="0 0 16 16">
                <path d="M10 1.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1A.5.5 0 0 0 6 1H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-2a.5.5 0 0 0-.5.5zm-4 1v-1h4v1H6zm7 11.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h1v1.5a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 11 3.5V2h1a1 1 0 0 1 1 1v11z"/>
            </svg>
        `;

        copyButton.addEventListener('click', () => {
            navigator.clipboard.writeText(codeBlock.textContent)
                .then(() => {
                    copyButton.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="green" class="bi bi-check" viewBox="0 0 16 16">
                            <path d="M13.485 1.921a.5.5 0 0 1 .043.708l-7 8a.5.5 0 0 1-.74-.045L2.854 7.354a.5.5 0 1 1 .707-.707l2.487 2.487 6.646-7.6a.5.5 0 0 1 .707-.042z"/>
                        </svg>
                    `;
                    setTimeout(() => {
                        copyButton.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-clipboard" viewBox="0 0 16 16">
                                <path d="M10 1.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1A.5.5 0 0 0 6 1H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2h-2a.5.5 0 0 0-.5.5zm-4 1v-1h4v1H6zm7 11.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h1v1.5a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 11 3.5V2h1a1 1 0 0 1 1 1v11z"/>
                            </svg>
                        `;
                    }, 2000);
                })
                .catch(err => console.error('Failed to copy text: ', err));
        });

        // Create select button
        const selectButton = document.createElement('button');
        selectButton.className = 'gpt-selectall-btn';
        selectButton.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M7 5C7 6.10457 6.10457 7 5 7C3.89543 7 3 6.10457 3 5C3 3.89543 3.89543 3 5 3C6.10457 3 7 3.89543 7 5Z" fill="#ffffff"/>
<path d="M8 5C8 5.55228 8.44772 6 9 6L15 6C15.5523 6 16 5.55228 16 5C16 4.44771 15.5523 4 15 4L9 4C8.44772 4 8 4.44772 8 5Z" fill="#ffffff"/>
<path d="M5 8C4.44772 8 4 8.44772 4 9V15C4 15.5523 4.44772 16 5 16C5.55228 16 6 15.5523 6 15V9C6 8.44772 5.55228 8 5 8Z" fill="#ffffff"/>
<path d="M19 8C18.4477 8 18 8.44772 18 9V15C18 15.5523 18.4477 16 19 16C19.5523 16 20 15.5523 20 15V9C20 8.44772 19.5523 8 19 8Z" fill="#ffffff"/>
<path d="M9 20C8.44772 20 8 19.5523 8 19C8 18.4477 8.44772 18 9 18H15C15.5523 18 16 18.4477 16 19C16 19.5523 15.5523 20 15 20H9Z" fill="#ffffff"/>
<path d="M5 21C6.10457 21 7 20.1046 7 19C7 17.8954 6.10457 17 5 17C3.89543 17 3 17.8954 3 19C3 20.1046 3.89543 21 5 21Z" fill="#ffffff"/>
<path d="M21 5C21 6.10457 20.1046 7 19 7C17.8954 7 17 6.10457 17 5C17 3.89543 17.8954 3 19 3C20.1046 3 21 3.89543 21 5Z" fill="#ffffff"/>
<path d="M19 21C20.1046 21 21 20.1046 21 19C21 17.8954 20.1046 17 19 17C17.8954 17 17 17.8954 17 19C17 20.1046 17.8954 21 19 21Z" fill="#ffffff"/>
</svg>
        `;

        selectButton.addEventListener('click', () => {
      const messageElement = document.querySelector(`.gpt-message.assistant-message:nth-child(${index + 1})`);
      messageElement.style.userSelect = 'text';
      
            const range = document.createRange();
            range.selectNodeContents(codeBlock);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        });

        // Append buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'gpt-code-btns-container';
        
        buttonContainer.appendChild(selectButton);
        buttonContainer.appendChild(copyButton);

        const pre = codeBlock.parentNode;
        pre.style.position = 'relative';
        pre.appendChild(buttonContainer);
    });
}

export function hasBalancedCodeBlocks(text) {
    const codeBlockMatches = text.match(/```/g);
    return codeBlockMatches && codeBlockMatches.length >= 2;
}

