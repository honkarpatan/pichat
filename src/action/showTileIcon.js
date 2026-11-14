import {paths} from '../data/path.js';

export function showTopIcon() {
  // Select the target tile element
  const targetTile = document.querySelector('.tile');
  if (targetTile) {
    // Create the span element
    const chatIconSpan = document.createElement('span');
    chatIconSpan.className = 'icon';
    chatIconSpan.setAttribute('action', 'toggle-chat-menu');
    chatIconSpan.style.fontSize = '1.2em';
    chatIconSpan.style.position = 'relative'; // important
    chatIconSpan.id = 'aicode'; // Add the id 'aicode'

    // Create the SVG element
    const chatIconSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chatIconSVG.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    chatIconSVG.setAttribute("x", "0px");
    chatIconSVG.setAttribute("y", "0px");
    chatIconSVG.setAttribute("viewBox", "0 0 48 48");
    chatIconSVG.setAttribute("height", "0.9em");
    chatIconSVG.setAttribute("width", "0.9em");

    paths.forEach(d => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "#546e7a");
      path.setAttribute("d", d);
      chatIconSVG.appendChild(path);
    });

    // Append the SVG to the span
    chatIconSpan.appendChild(chatIconSVG);

    // --- ADD SPINNER ---
    const spinner = document.createElement('span');
    spinner.id = 'gpt-spinner';
    spinner.style.position = 'absolute';
    spinner.style.top = '0';
    spinner.style.left = '0';
    spinner.style.right = '0';
    spinner.style.bottom = '0';
    spinner.style.margin = 'auto';
    spinner.style.width = '16px';
    spinner.style.height = '16px';
    spinner.style.border = '2px solid #ccc';
    spinner.style.borderTop = '2px solid #546e7a';
    spinner.style.borderRadius = '50%';
    spinner.style.animation = 'spinGPT 1s linear infinite';
    spinner.style.display = 'none'; // HIDDEN initially

    chatIconSpan.appendChild(spinner);

    // Insert the span as the third child
    if (targetTile.children.length >= 2) {
      targetTile.insertBefore(chatIconSpan, targetTile.children[2]);
    } else {
      targetTile.appendChild(chatIconSpan);
    }
  }
}