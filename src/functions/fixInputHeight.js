export function fixInputHeight(){
        // Text area increase height on input
    const userInput = document.getElementById('gpt-user-input');
    userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.minHeight = '20px';
    userInput.style.maxHeight = '100px';
    
    userInput.style.height = (userInput.scrollHeight-56) + 'px';
    });
    

    // Convert to floating bubble on scroll
    userInput.addEventListener('scroll', () => {
        const scrollPosition = userInput.scrollTop;
    });
    
    userInput.addEventListener("focusout", () => {
      if(userInput.value == ''){
        userInput.style.height = "20px";
      }
    });
    userInput.addEventListener("focus", () => {
      if(userInput.value == ''){
        userInput.style.height = "20px";
      }
    });
    userInput.addEventListener("blur", () => {
      if(userInput.value == ''){
        userInput.style.height = "20px";
      }
    });
  }
  