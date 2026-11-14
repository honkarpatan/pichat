export function detectCode(text) {
    // Patterns for various programming languages
    const codePatterns = [
        // General patterns
        /[{}[\]();]/,                              // Brackets, parentheses, semicolons
        /".*?"|'.*?'/,                             // Strings in double or single quotes
        /\bif\b|\belse\b|\bfor\b|\bwhile\b/,       // Common control flow structures
        /class\s|function\s|return\s|import\s/,    // Keywords in JS, Java, Python
        /<\/?\w+>/,                                // HTML/XML tags
        /\bconst\b|\blet\b|\bvar\b/,               // JS variable declarations
        /\bint\b|\bfloat\b|\bdouble\b|\bString\b/, // Java data types
        /def\s|\bself\b|\bprint\b/,                // Python keywords
        /\btry\b|\bcatch\b|\bfinally\b/,           // Exception handling in JS, Java
        /\bimport\b|\bexport\b/,                   // Import/export in JS, Python
        /#\s*\w+/g,                                // Python comments
        /\/\/.*$/,                                 // Single-line comments (JS, Java)
        /\/\*[\s\S]*?\*\//,                        // Multi-line comments (JS, Java, CSS)
        /\bconsole\.log\b|\bSystem\.out\.print\b/, // Print statements in JS, Java
        /\bpublic\b|\bprivate\b|\bprotected\b/,    // Java access modifiers
        /\s{2,}/,                                  // Multiple spaces (indentation)
        
        // CSS-specific patterns
        /\.\w+\s?\{[\s\S]*?\}/,                    // CSS class declarations
        /#\w+\s?\{[\s\S]*?\}/,                     // CSS ID declarations
        /\bcolor\b|\bfont-size\b|\bbackground\b/,  // CSS properties

        // HTML-specific patterns
        /<!DOCTYPE html>/i,                        // HTML5 doctype
        /<head>|<body>|<div>|<span>|<a>|<p>/,      // Common HTML tags
        /<style>|<script>|<link>|<meta>/,          // HTML tags related to CSS and JS

        // JavaScript-specific patterns
        /\basync\b|\bawait\b/,                     // Async/await in JS
        /\bfetch\b|\baxios\b|\bXMLHttpRequest\b/,  // Web requests in JS

        // Java-specific patterns
        /\bimplements\b|\bextends\b/,              // Java inheritance
        /\bstatic\b|\bvoid\b|\bnew\b/,             // Java-specific keywords

        // Python-specific patterns
        /\bdef\b|\blambda\b|\bwith\b/,             // Python function and block keywords
        /\bTrue\b|\bFalse\b|\bNone\b/,             // Python boolean and None

        // Other common symbols in code
        /\=\>|\->/,                                // Arrow functions in JS, lambda in Python
        /&&|\|\|/,                                 // Logical operators
        /\b\d+\b/,                                 // Numbers (constants, literals)
    ];

    // Check for any of the patterns
    for (const pattern of codePatterns) {
        if (pattern.test(text)) {
            return true;
        }
    }

    // If none of the patterns match, it's likely normal text
    return false;
}

// // Example usage:
// const normalText = "This is a normal sentence without any code or programming syntax.";
// const codeTextJS = `function greet() {
//     console.log("Hello, World!");
// }`;
// const codeTextJava = `public class HelloWorld {
//     public static void main(String[] args) {
//         System.out.println("Hello, World!");
//     }
// }`;
// const codeTextPython = `def greet():
//     print("Hello, World!")`;
// const codeTextHTML = `<html>
// <head><title>My Website</title></head>
// <body><h1>Hello, World!</h1></body>
// </html>`;
// const codeTextCSS = `body {
//     font-size: 16px;
//     background-color: #f0f0f0;
// }`;

// console.log(detectCode(normalText));    // Output: Normal text detected
// console.log(detectCode(codeTextJS));    // Output: Code detected
// console.log(detectCode(codeTextJava));  // Output: Code detected
// console.log(detectCode(codeTextPython));// Output: Code detected
// console.log(detectCode(codeTextHTML));  // Output: Code detected
// console.log(detectCode(codeTextCSS));   // Output: Code detected

export function countLines(text) {
    if (!text) return 0;
    // Split the text by new line characters and return the length of the array
    return text.split('\n').length;
}

// // Example usage:
// const sampleText = `This is line 1.
// This is line 2.
// This is line 3.`;

// console.log(countLines(sampleText)); // Output: 3