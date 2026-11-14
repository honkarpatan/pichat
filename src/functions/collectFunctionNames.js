// export function collectFunctionNames(code) {
//     const result = [];
//     const reservedKeywords = ['for', 'if', 'else', 'while', 'switch', 'do','function','class','on','replace','catch','try','then'];

//     const patterns = {
//         asyncFunction: /async\s+function\s+(\w+)\s*\(/g,                 // JavaScript async function
//         regularFunction: /function\s+(\w+)\s*\(/g,                        // JavaScript regular function
//         arrowFunction: /(\w+)\s*=\s*\(.*?\)\s*=>/g,                       // JavaScript arrow function
//         class: /class\s+(\w+)/g,                                          // JavaScript/Java/Python class
//         classMethod: /(\w+)\s*\(\)\s*{/g,                                 // JavaScript class method
//         pythonFunction: /def\s+(\w+)\s*:/g,                               // Python function
//         javaMethod: /(?:public|protected|private)?\s*(?:static)?\s*(?:final)?\s*(?:\w+)\s+(\w+)\s*\(.*?\)\s*{/g, // Java method
//         javaConstructor: /(?:public|protected|private)?\s*(\w+)\s*\(.*?\)\s*{/g, // Java constructor
//         javaInterface: /interface\s+(\w+)/g,                              // Java interface
//         pythonClassMethod: /def\s+(\w+)\s*\(self[,\s]*.*?\)\s*:/g         // Python class method
//     };

//     const seenNames = new Set();

//     for (let type in patterns) {
//         let match;
//         while (match = patterns[type].exec(code)) {
//             const name = match[1];
//             if (!reservedKeywords.includes(name) && !seenNames.has(name)) {
//                 seenNames.add(name);
//                 result.push({ name, type: type.replace(/([A-Z])/g, '_$1').toLowerCase() });
//             }
//         }
//     }

//     return result;
// }

// {
// const value = `
// // JavaScript code
// function P(a, b) {
//     async function A(a, b) {
//       while(true){
//         console.log('hello world');
//       }
//     };

//     function B(a, b) {
//         // Function B content
//     };
// }
// let ball = 'ball';

// const mul = (a, b) => {
//     console.log(a * b);
//     return a * b ;
// };

// class car {
//   op() {
// for(i=0;i<10;i++){
//   console.log(i);
// }
//   }
// }

// // Python code
// def race:
//   ...
  
// class Vehicle:
//     def start(self):
//         pass
        
//     def drive(self, speed):
//         pass

// // Java code
// public class Main {
//     public static void main(String[] args) {
//         System.out.println("Hello, World!");
//     }
    
//     private static void helper() {
//         // Helper function
//     }
// }

// public interface MyInterface {
//     void doSomething();
// }
// `;

// const result = collectFunctionNames(value);
// console.log(result);

// // output :
// // Array
// // 0:Object
// // name:A
// // type:async_function
// // __proto__:...
// // 1:Object
// // name:P
// // type:regular_function
// // __proto__:...
// // 2:Object
// // name:B
// // type:regular_function
// // __proto__:...
// // 3:Object
// // name:mul
// // type:arrow_function
// // __proto__:...
// // 4:Object
// // name:car
// // type:class
// // __proto__:...
  
// // }


// const functionPatterns = {
//     // JavaScript Patterns
//     async_arrow_function: /\basync\s+const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g,
//     arrow_function: /\bconst\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g,
//     regular_function: /\bfunction\s+(\w+)\s*\([^)]*\)\s*{/g,
//     class: /\bclass\s+(\w+)\s*{/g,
//     class_method: /\b(\w+)\s*\([^)]*\)\s*{/g,

//     // TypeScript Patterns
//     ts_arrow_function: /\bconst\s+(\w+):\s*\([^)]*\)\s*=>\s*\([^)]*\)\s*=>\s*{/g,
//     ts_async_arrow_function: /\bconst\s+(\w+):\s*\([^)]*\)\s*=>\s*Promise<[^>]*>\s*=\s*async\s*\([^)]*\)\s*=>\s*{/g,
//     ts_regular_function: /\bfunction\s+(\w+)\s*\([^)]*\)\s*:\s*[^\\s]*\s*{/g,
//     ts_async_regular_function: /\basync\s+function\s+(\w+)\s*\([^)]*\)\s*:\s*Promise<[^>]*>\s*{/g,

//     // Java Patterns
//     java_method: /\b(public|protected|private|static|final|abstract)?\s*\w+\s+(\w+)\s*\([^)]*\)\s*{/g,
//     java_class: /\bclass\s+(\w+)\s*{/g,
//     java_constructor: /\b(public|protected|private)?\s+(\w+)\s*\([^)]*\)\s*{/g,
//     java_interface: /\binterface\s+(\w+)\s*{/g,
//     java_enum: /\benum\s+(\w+)\s*{/g,
//     java_abstract_class: /\babstract\s+class\s+(\w+)\s*{/g,

//     // Kotlin Patterns
//     kotlin_function: /\b(public|private|protected|internal|override|abstract)?\s*\w+\s+(\w+)\s*\([^)]*\)\s*:\s*\w*\s*{/g,
//     kotlin_constructor: /\bconstructor\s*\([^)]*\)\s*{/g,
//     kotlin_class: /\bclass\s+(\w+)\s*{/g,
//     kotlin_interface: /\binterface\s+(\w+)\s*{/g,
//     kotlin_data_class: /\bdata\s+class\s+(\w+)\s*{/g,
//     kotlin_abstract_class: /\babstract\s+class\s+(\w+)\s*{/g,
//     kotlin_enum_class: /\benum\s+class\s+(\w+)\s*{/g,

//     // C# Patterns
//     csharp_method: /\b(public|private|protected|static|virtual|override)?\s+\w+\s+(\w+)\s*\([^)]*\)\s*{/g,
//     csharp_class: /\bclass\s+(\w+)\s*{/g,

//     // C Patterns
//     c_function: /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*{/g,
//     c_struct: /\bstruct\s+(\w+)\s*{/g,

//     // PHP Patterns
//     php_function: /\bfunction\s+(\w+)\s*\([^)]*\)\s*{/g,
//     php_class: /\bclass\s+(\w+)\s*{/g,

//     // Python Patterns
//     python_function: /\bdef\s+(\w+)\s*\([^)]*\)\s*:/g,
//     python_class: /\bclass\s+(\w+)\s*:/g,

//     // Anonymous Functions
//     anonymous_function_expr: /\bfunction\s*\([^)]*\)\s*{/g,
//     anonymous_arrow_function: /\b\([^)]*\)\s*=>\s*{/g,
//     anonymous_async_arrow_function: /\basync\s*\([^)]*\)\s*=>\s*{/g,
// };

// export function collectFunctionNames(code) {
//     const result = [];
//     const reservedKeywords = new Set([
//     // JavaScript Reserved Keywords
//     'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 
//     'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 
//     'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 
//     'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 
//     'with', 'yield', 

//     // Future Reserved Keywords
//     'implements', 'interface', 'package', 'private', 'protected', 'public', 
//     'static', 'await', 'async',

//     // Global Objects and Built-ins
//     'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Math', 'Number', 
//     'Object', 'Promise', 'RegExp', 'String', 'Symbol', 'Map', 'Set', 'WeakMap', 
//     'WeakSet', 'BigInt', 'Infinity', 'NaN', 'undefined',

//     // Common JavaScript Methods and Properties
//     'constructor', 'prototype', 'hasOwnProperty', 'isPrototypeOf', 'valueOf', 
//     'toString', 'toLocaleString', 'length', 'name', 'call', 'apply', 'bind',

//     // DOM and BOM Keywords
//     'window', 'document', 'navigator', 'location', 'history', 'console', 
//     'alert', 'prompt', 'confirm', 'fetch', 'setTimeout', 'setInterval', 
//     'clearTimeout', 'clearInterval',

//     // Common Method or Variable Names
//     'on', 'to', 'from', 'replace', 'catch', 'try', 'then', 'log', 'data', 
//     'info', 'error', 'warn', 'debug', 'success', 'callback', 'result', 'value',

//     // Framework and Library Common Keywords
//     'react', 'vue', 'angular', 'next', 'nuxt', 'redux', 'context', 'state', 
//     'props', 'component', 'module', 'exports', 'require',

//     // Common SQL-like Keywords (if relevant)
//     'select', 'insert', 'update', 'delete', 'where', 'join', 'inner', 
//     'outer', 'left', 'right', 'group', 'order', 'by', 'limit', 'offset',

//     // Additional Miscellaneous Words
//     'key', 'keys', 'values', 'entries', 'map', 'filter', 'reduce', 
//     'forEach', 'find', 'includes', 'push', 'pop', 'shift', 'unshift', 
//     'slice', 'splice', 'sort', 'reverse'
// ]);

//     const seenNames = new Set();

//     for (const [type, pattern] of Object.entries(functionPatterns)) {
//         let match;
//         while ((match = pattern.exec(code)) !== null) {
//             const name = match[1]; // Extract the function/class name if available

//             // Skip reserved keywords and duplicates
//             if (name && !reservedKeywords.has(name) && !seenNames.has(name)) {
//                 seenNames.add(name);
//                 result.push({
//                     name,
//                     type: type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
//                 });
//             }
//         }
//     }

//     // Return collected function names
//     console.log('Found functions:', result);
//     return result;
// }

const functionPatterns = {
    // JavaScript Patterns
    async_function: /\basync\s+function\s+(\w+)\s*\([^)]*\)\s*{/g, // Matches 'async function name'
    async_arrow_function: /\basync\s+const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g,
    arrow_function: /\bconst\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g,
    regular_function: /\bfunction\s+(\w+)\s*\([^)]*\)\s*{/g,
    class: /\bclass\s+(\w+)\s*{/g,
    class_method: /\b(\w+)\s*\([^)]*\)\s*{/g,

    // TypeScript Patterns
    ts_arrow_function: /\bconst\s+(\w+):\s*\([^)]*\)\s*=>\s*\([^)]*\)\s*=>\s*{/g,
    ts_async_arrow_function: /\bconst\s+(\w+):\s*\([^)]*\)\s*=>\s*Promise<[^>]*>\s*=\s*async\s*\([^)]*\)\s*=>\s*{/g,
    ts_regular_function: /\bfunction\s+(\w+)\s*\([^)]*\)\s*:\s*[^\\s]*\s*{/g,
    ts_async_regular_function: /\basync\s+function\s+(\w+)\s*\([^)]*\)\s*:\s*Promise<[^>]*>\s*{/g,

    // Java Patterns
    java_method: /\b(public|protected|private|static|final|abstract)?\s*\w+\s+(\w+)\s*\([^)]*\)\s*{/g,
    java_class: /\bclass\s+(\w+)\s*{/g,
    java_constructor: /\b(public|protected|private)?\s+(\w+)\s*\([^)]*\)\s*{/g,
    java_interface: /\binterface\s+(\w+)\s*{/g,
    java_enum: /\benum\s+(\w+)\s*{/g,
    java_abstract_class: /\babstract\s+class\s+(\w+)\s*{/g,

    // Kotlin Patterns
    kotlin_function: /\b(public|private|protected|internal|override|abstract)?\s*\w+\s+(\w+)\s*\([^)]*\)\s*:\s*\w*\s*{/g,
    kotlin_constructor: /\bconstructor\s*\([^)]*\)\s*{/g,
    kotlin_class: /\bclass\s+(\w+)\s*{/g,
    kotlin_interface: /\binterface\s+(\w+)\s*{/g,
    kotlin_data_class: /\bdata\s+class\s+(\w+)\s*{/g,
    kotlin_abstract_class: /\babstract\s+class\s+(\w+)\s*{/g,
    kotlin_enum_class: /\benum\s+class\s+(\w+)\s*{/g,

    // C# Patterns
    csharp_method: /\b(public|private|protected|static|virtual|override)?\s+\w+\s+(\w+)\s*\([^)]*\)\s*{/g,
    csharp_class: /\bclass\s+(\w+)\s*{/g,

    // C Patterns
    c_function: /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*{/g,
    c_struct: /\bstruct\s+(\w+)\s*{/g,

    // PHP Patterns
    php_function: /\bfunction\s+(\w+)\s*\([^)]*\)\s*{/g,
    php_class: /\bclass\s+(\w+)\s*{/g,

    // Python Patterns
    python_function: /\bdef\s+(\w+)\s*\([^)]*\)\s*:/g,
    python_class: /\bclass\s+(\w+)\s*:/g,

    // Anonymous Functions
    anonymous_function_expr: /\bfunction\s*\([^)]*\)\s*{/g,
    anonymous_arrow_function: /\b\([^)]*\)\s*=>\s*{/g,
    anonymous_async_arrow_function: /\basync\s*\([^)]*\)\s*=>\s*{/g,
};
const reservedKeywords = new Set([
    // JavaScript Reserved Keywords
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 
    'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 
    'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 
    'with', 'yield', 

    // Future Reserved Keywords
    'implements', 'interface', 'package', 'private', 'protected', 'public', 
    'static', 'await', 'async',

    // Global Objects and Built-ins
    'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Math', 'Number', 
    'Object', 'Promise', 'RegExp', 'String', 'Symbol', 'Map', 'Set', 'WeakMap', 
    'WeakSet', 'BigInt', 'Infinity', 'NaN', 'undefined',

    // Common JavaScript Methods and Properties
    'constructor', 'prototype', 'hasOwnProperty', 'isPrototypeOf', 'valueOf', 
    'toString', 'toLocaleString', 'length', 'name', 'call', 'apply', 'bind',

    // DOM and BOM Keywords
    'window', 'document', 'navigator', 'location', 'history', 'console', 
    'alert', 'prompt', 'confirm', 'fetch', 'setTimeout', 'setInterval', 
    'clearTimeout', 'clearInterval',

    // Common Method or Variable Names
    'on', 'to', 'from', 'replace', 'catch', 'try', 'then', 'log', 'data', 
    'info', 'error', 'warn', 'debug', 'success', 'callback', 'result', 'value',

    // Framework and Library Common Keywords
    'react', 'vue', 'angular', 'next', 'nuxt', 'redux', 'context', 'state', 
    'props', 'component', 'module', 'exports', 'require',

    // Common SQL-like Keywords (if relevant)
    'select', 'insert', 'update', 'delete', 'where', 'join', 'inner', 
    'outer', 'left', 'right', 'group', 'order', 'by', 'limit', 'offset',

    // Additional Miscellaneous Words
    'key', 'keys', 'values', 'entries', 'map', 'filter', 'reduce', 
    'forEach', 'find', 'includes', 'push', 'pop', 'shift', 'unshift', 
    'slice', 'splice', 'sort', 'reverse'
]);

export function collectFunctionNames(code) {
    const result = [];


    const seenNames = new Set();

    for (const [type, pattern] of Object.entries(functionPatterns)) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
            const name = match[1]; // Extract the function/class name if available

            // Skip reserved keywords and duplicates
            if (name && !reservedKeywords.has(name) && !seenNames.has(name)) {
                seenNames.add(name);
                result.push({
                    name,
                    type: type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
                });
            }
        }
    }

    // Return collected function names
    console.log('Found functions:', result);
    return result;
}

function getFunctionNameFromDeclaration(str) {
    // Step 1: Remove keywords like 'function', 'async', 'export', etc.
    str = str.replace(/\b(function|async|export)\b/g, '').trim();

    // Step 2: Remove parameters in parentheses and curly braces
    str = str.replace(/\(.*?\)/g, '').replace(/{.*?}/g, '').trim();

    // Step 3: Extract the first word (function/keyword name)
    let match = str.match(/^\w+/);
    return match ? match[0] : null;
}

export function findFunctionBoundary(text, cursorRow, direction , noOfFunction = 1, CodeLength =1500 ) {
    // Split text into lines
    const lines = text.split("\n");
    console.log('text',text);
    const totalLines = lines.length;
    let countFunction = 0 ;

    // Normalize cursorRow
    cursorRow = Math.max(0, Math.min(cursorRow, totalLines - 1));

    // Helper function to test all patterns and ensure it's not a reserved keyword
    const matchFunctionDeclaration = (line) => {
        for (const [key, pattern] of Object.entries(functionPatterns)) {
            const match = line.trim().match(pattern);
            if (match) {
                const functionName = getFunctionNameFromDeclaration(match[0]); // Capture the function name
                if (!reservedKeywords.has(functionName)) {
                    return { isFunction: true, functionName };
                }
            }
        }
        return { isFunction: false };
    };

    // Function to extract text between startRow and endRow
    const extractData = (startRow, endRow) => lines.slice(startRow, endRow + 1).join("\n");

    // Search upward with a length limit of 1500
    if (direction === "up") {
        let totalLength = 0;
        for (let row = cursorRow - 1; row >= 0; row--) {
            totalLength += lines[row].length;
            const { isFunction, functionName } = matchFunctionDeclaration(lines[row]);
            if (isFunction || totalLength > 1500) {
                // return {
                //     startRow: row,
                //     endRow: cursorRow,
                //     functionName: isFunction ? functionName : null,
                //     direction,
                //     data: extractData(row, cursorRow-1),
                // };
              countFunction++ ;
              console.log('countFunction :',countFunction);
              console.log('row-1 :',row-1);
              if(countFunction > noOfFunction - 1 ){ // set match no
              console.log('mmmmm');
                return {
                    startRow: cursorRow,
                    endRow: row ,
                    functionName,
                    direction,
                    data: extractData(row-1 ,cursorRow),
                };
              }  
            }
        }
    }

    // Search downward, stop when a function is found
    if (direction === "down") {
        for (let row = cursorRow + 1; row < totalLines; row++) {
            const { isFunction, functionName } = matchFunctionDeclaration(lines[row]);
            if (isFunction) {
              countFunction++ ;
              console.log('countFunction :',countFunction);
              if(countFunction > noOfFunction){ // set match no
                return {
                    startRow: cursorRow,
                    endRow: row ,
                    functionName,
                    direction,
                    data: extractData(cursorRow, row-1),
                };
              }  
            }
        }
    }

    // Bidirectional search (direction = "this" or fallback)
    if (direction === "this" || direction === "up" || direction === "down") {
        let upperPos = cursorRow - 1;
        let lowerPos = cursorRow + 1;
        let totalLength = 0;

        while (upperPos >= 0 || lowerPos < totalLines) {
            // Check upward with a length limit
            if (upperPos >= 0) {
                totalLength += lines[upperPos].length;
                const { isFunction, functionName } = matchFunctionDeclaration(lines[upperPos]);
                if (isFunction || totalLength > 2000) {
                    return {
                        startRow: Math.max(0, upperPos),
                        endRow: Math.min(totalLines - 1, lowerPos - 1),
                        functionName: isFunction ? functionName : null,
                        direction,
                        data: extractData(Math.max(0, upperPos), Math.min(totalLines - 1, lowerPos-1)),
                    };
                }
                upperPos--;
            }

            // Check downward
            if (lowerPos < totalLines) {
                const { isFunction, functionName } = matchFunctionDeclaration(lines[lowerPos]);
                if (isFunction) {
                    return {
                        startRow: Math.max(0, upperPos + 1),
                        endRow: lowerPos,
                        functionName,
                        direction,
                        data: extractData(Math.max(0, upperPos + 1), lowerPos),
                    };
                }
                lowerPos++;
            }
        }
        
        

        // If no match is found in bidirectional search
        return {
            startRow: Math.max(0, upperPos + 1),
            endRow: Math.min(totalLines - 1, lowerPos - 1),
            functionName: null,
            direction,
            data: extractData(Math.max(0, upperPos + 1), Math.min(totalLines - 1, lowerPos - 1)),
        };
    }

    // If invalid direction or no match found
    return null;
}