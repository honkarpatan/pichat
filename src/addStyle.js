export function addStyles() {
    const styleElement = document.createElement("style");
    styleElement.innerHTML = `
code[class*="language-"],
pre[class*="language-"] {
	color: #f8f8f2;
	background: none;
	text-shadow: 0 1px rgba(0, 0, 0, 0.3);
	font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
	font-size: 0.95em;
	text-align: left;
	white-space: pre;
	word-spacing: normal;
	word-break: normal;
	word-wrap: normal;
	line-height: 1.5;

	-moz-tab-size: 4;
	-o-tab-size: 4;
	tab-size: 4;

	-webkit-hyphens: none;
	-moz-hyphens: none;
	-ms-hyphens: none;
	hyphens: none;
}



pre[class*="language-"] {
	padding: 1em;
	margin: .5em 0;
	overflow: auto;
	border-radius: 0.3em;
	padding-top: 2em;
	position: relative;
}


pre[class*="language-"] code::before {
    /* content: attr(data-language);
    position: absolute;
    top: 0;
    left: 0;
    background-color: #363636;
    color: #f8f8f2;
    font-weight: bold;
    padding: 0.5em;
    border-top-left-radius: 5px;
    border-bottom-right-radius: 5px;
    font-size: 0.85em;
    width:100% ;
    height: 0.9em; */
}

pre[class*="language-"] .copy-btn {
    position: absolute;
    top: 0;
    right: 0em;
    background-color: transparent;
    border: none;
    color: #f8f8f2;
    padding: 0.2em;
    border-top-right-radius: 5px;
    border-bottom-left-radius: 5px;
    cursor: pointer;
    font-size: 0.65em;
    display: flex;
    align-items: center;
}
pre[class*="language-"] .copy-btn svg {
  fill: #f8f8f2;
          }
  pre[class*="language-"] .gpt-selectall-btn {
    position: absolute;
    top: 0;
    right: 4em;
    background-color: transparent;
    border: none;
    color: #f8f8f2;
    padding: 0.2em;
    border-top-right-radius: 5px;
    border-bottom-left-radius: 5px;
    cursor: pointer;
    font-size: 0.65em;
    display: flex;
    align-items: center;
}
pre[class*="language-"] .gpt-selectall-btn svg {
  fill: #f8f8f2;
          } 
          
:not(pre) > code[class*="language-"],
pre[class*="language-"] {
	background: #1b1b1b;
}




/* Inline code */
:not(pre) > code[class*="language-"] {
	padding: .1em;
	border-radius: .3em;
	white-space: normal;
}

.token.comment,
.token.prolog,
.token.doctype,
.token.cdata {
	color: #8292a2;
}

.token.punctuation {
	color: #f8f8f2;
}

.token.namespace {
	opacity: .7;
}

.token.property,
.token.tag,
.token.constant,
.token.symbol,
.token.deleted {
	color: #f92672;
}

.token.boolean,
.token.number {
	color: #ae81ff;
}

.token.selector,
.token.attr-name,
.token.string,
.token.char,
.token.builtin,
.token.inserted {
	color: #a6e22e;
}

.token.operator,
.token.entity,
.token.url,
.language-css .token.string,
.style .token.string,
.token.variable {
	color: #f8f8f2;
}

.token.atrule,
.token.attr-value,
.token.function,
.token.class-name {
	color: #e6db74;
}

.token.keyword {
	color: #66d9ef;
}

.token.regex,
.token.important {
	color: #fd971f;
}

.token.important,
.token.bold {
	font-weight: bold;
}
.token.italic {
	font-style: italic;
}

.token.entity {
	cursor: help;
}

.token a {
	color: inherit;
}
div.code-toolbar {
	position: relative;
}

div.code-toolbar > .toolbar {
	position: absolute;
	z-index: 10;
	top: .3em;
	right: .2em;
	transition: opacity 0.3s ease-in-out;
	opacity: 0;
}

div.code-toolbar:hover > .toolbar {
	opacity: 1;
}

div.code-toolbar:focus-within > .toolbar {
	opacity: 1;
}

div.code-toolbar > .toolbar > .toolbar-item {
	display: inline-block;
}

div.code-toolbar > .toolbar > .toolbar-item > a {
	cursor: pointer;
}

div.code-toolbar > .toolbar > .toolbar-item > button {
	background: none;
	border: 0;
	color: inherit;
	font: inherit;
	line-height: normal;
	overflow: visible;
	padding: 0;
	-webkit-user-select: none; 
	-moz-user-select: none;
	-ms-user-select: none;
}

div.code-toolbar > .toolbar > .toolbar-item > a,
div.code-toolbar > .toolbar > .toolbar-item > button,
div.code-toolbar > .toolbar > .toolbar-item > span {
	color: #bbb;
	font-size: .8em;
	padding: 0 .5em;
	background: #f5f2f0;
	background: rgba(224, 224, 224, 0.2);
	box-shadow: 0 2px 0 0 rgba(0,0,0,0.2);
	border-radius: .5em;
}

div.code-toolbar > .toolbar > .toolbar-item > a:hover,
div.code-toolbar > .toolbar > .toolbar-item > a:focus,
div.code-toolbar > .toolbar > .toolbar-item > button:hover,
div.code-toolbar > .toolbar > .toolbar-item > button:focus,
div.code-toolbar > .toolbar > .toolbar-item > span:hover,
div.code-toolbar > .toolbar > .toolbar-item > span:focus {
	color: inherit;
	text-decoration: none;
}

span.inline-color-wrapper {
	background: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyIDIiPjxwYXRoIGZpbGw9ImdyYXkiIGQ9Ik0wIDBoMnYySDB6Ii8+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0wIDBoMXYxSDB6TTEgMWgxdjFIMXoiLz48L3N2Zz4=");
	background-position: center;
	background-size: 110%;

	display: inline-block;
	height: 1.333ch;
	width: 1.333ch;
	margin: 0 .333ch;
	box-sizing: border-box;
	border: 1px solid white;
	outline: 1px solid rgba(0,0,0,.5);
	overflow: hidden;
}

span.inline-color {
	display: block;
	height: 120%;
	width: 120%;
}
`;
  document.head.appendChild(styleElement);
}
