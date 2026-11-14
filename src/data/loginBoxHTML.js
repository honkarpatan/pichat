import { icons } from './svg.js';

export const loginBoxHTML = `<div class="gpt-login-page">
  
  <button class="gpt-sign-page-close-gpt" title="Close">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
  </button> 

  <div id="login-box" class="login-box">
    
    <div class="gpt-login-header">
        <div class="gpt-login-logo">
            ${icons.modelLogoWhite}
        </div>
        <h2 class="gpt-login-title">AiCode GPT</h2>
        <p class="gpt-login-subtitle">Sign in to sync your workspace</p>
    </div>

    <div class="gpt-login-container gpt-show-navigate">
      <div class="login-form">
        
        <div class="gpt-input-wrapper">
            <svg class="gpt-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            <input type="email" placeholder="Registered Email" class="input-field" id="gpt-login-email">
        </div>
        
        <div class="gpt-input-wrapper">
            <svg class="gpt-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            <input type="password" placeholder="Access Key" class="input-field" id="gpt-login-key">
        </div>

        <button type="submit" id="gpt-login-button" class="login-button">
          <span>Secure Login</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </button>
      </div>
      
      <div class="gpt-signup-link" id="gpt-signup">Don't have an Access Key? <span>Get one here</span></div>
      
      <div class="gpt-declaimer-message">
        By continuing, you agree to local data processing.<br>
        Models run locally or via official API keys.
      </div>
    </div>

    <div class="gpt-signup-container gpt-hide-navigate">
      <div class="signup-form">
        <iframe src="https://aicode-tokens.vercel.app/" width="100%" height="520px" frameborder="0" style="border-radius: 12px; overflow: hidden;"></iframe>
      </div>
      <div class="gpt-signin-link" id="gpt-signin">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        Back to Login
      </div>
    </div>

  </div>
</div>`;