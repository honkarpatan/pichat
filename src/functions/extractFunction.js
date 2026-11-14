// const values = `// Function to check if a number is prime
// function(a, b) {
//     return a + b;
// }

// function isPrime(num) {
//   if (num < 2) {
//     return false;
//   }
//   for (let i = 2; i <= Math.sqrt(num); i++) {
//     if (num % i === 0) {
//       return false;
//     }
//   }
//   return true;
// }

// // Function to calculate the square root of a number
// function squareRoot(num) {
//   function innerFunctionGcd(a, b) {
//   if (b === 0) {
//     return a;
//   } else {
//     return gcd(b, a % b);
//   }
//   }
//   if (num < 0) {
//     throw new Error('Input must be non-negative');
//   }
//   if (num === 0 || num === 1) {
//     return num;
//   }
//   let low = 1;
//   let high = num;
//   while (low <= high) {
//     let mid = Math.floor((low + high) / 2);
//     if (mid * mid === num) {
//       return mid;
//     } else if (mid * mid < num) {
//       low = mid + 1;
//       continue;
//     } else {
//       high = mid - 1;
//     }
//   }
//   return low - 1;
// }
// const armadilo = () =>{
//   console.log('hello world');
// }
// `;


// export async function extractFunctionByName(value, functionName) {
//   // Patterns for both regular functions, arrow functions, and class methods
//   const functionPatterns = {
//     // JavaScript (ES6+)
//     async_arrow_function: new RegExp(`async\\s+const\\s+${functionName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
//     arrow_function: new RegExp(`\\s+const\\s+${functionName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
//     regular_function: new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     class_method: new RegExp(`\\b${functionName}\\s*\\(([^)]*)\\)\\s*{[^}]*}`, 's'),
//     interface: new RegExp(`interface\\s+${functionName}\\s*{[^}]*}`, 's') ,
//     // TypeScript 
//     ts_arrow_function: new RegExp(`const\\s+${functionName}:\\s*\\([^)]*\\)\\s*=>\\s*[^=]*=\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
//     ts_async_arrow_function: new RegExp(`const\\s+${functionName}:\\s*\\([^)]*\\)\\s*=>\\s*Promise<[^>]*>\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
//     ts_regular_function: new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*:\\s*[^\\s]*\\s*{[^}]*}`, 's'),
//     ts_async_regular_function: new RegExp(`async\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*:\\s*Promise<[^>]*>\\s*{[^}]*}`, 's'),
//     // Java
//     java_method: new RegExp(`(public|protected|private|static|final|abstract)?\\s*\\w+\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     java_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     java_constructor: new RegExp(`(public|protected|private)?\\s*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     java_interface: new RegExp(`interface\\s+${functionName}\\s*{[^}]*}`, 's'),
//       java_enum: new RegExp(`enum\\s+${functionName}\\s*{[^}]*}`, 's'),
//     java_abstract_class: new RegExp(`abstract\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     // Kotlin Method
//     kotlin_function: new RegExp(`(public|private|protected|internal|override|abstract)?\\s*(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*:\\s*\\w*\\s*\\{[^}]*}`, 's'),
//     kotlin_constructor: new RegExp(`constructor\\s*\\([^)]*\\)\\s*\\{[^}]*}`, 's'),
//     kotlin_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     kotlin_interface: new RegExp(`interface\\s+${functionName}\\s*{[^}]*}`, 's'),
//     kotlin_data_class: new RegExp(`data\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     kotlin_abstract_class: new RegExp(`abstract\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     kotlin_enum_class: new RegExp(`enum\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     // C#
//     csharp_method: new RegExp(`(public|private|protected|static|virtual|override)?\\s+\\w+\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     csharp_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
    
//     // C
//     c_function: new RegExp(`(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     c_struct: new RegExp(`struct\\s+${functionName}\\s*{[^}]*}`, 's'),
//     c_method: new RegExp(`(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     // C++
//     cpp_method: new RegExp(`(public|protected|private)?\\s*(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     cpp_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's') ,
//     // PHP
//     php_function: new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     php_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
//     php_method: new RegExp(`public\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),

//     // Python
//     python_function: new RegExp(`def\\s+${functionName}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
//     python_class: new RegExp(`class\\s+${functionName}\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
//     python_method: new RegExp(`def\\s+${functionName}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
//         //Anonymous JavaScript Function Expression
//     anonymous_function_expr: new RegExp(`function\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
// //   Anonymous Arrow Function
//     anonymous_arrow_function: new RegExp(`\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),
// //   Anonymous Async Arrow Function
//     anonymous_async_arrow_function: new RegExp(`async\\s*\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),
// };


//   let functionType = null;
//   let startIndex = -1;
//   let braceCount = 0;
//   let endIndex = -1;

//   // Check patterns to find the type and start index
//   for (const [type, pattern] of Object.entries(functionPatterns)) {
//     const matchStart = value.match(pattern);
//     if (matchStart) {
//       functionType = type;
//       startIndex = matchStart.index;
//       break;
//     }
//   }

//   if (!functionType) return { data: null, type: null }; // Return null if the function is not found

//   // Iterate over the string starting from the function's opening brace
//   for (let i = startIndex; i < value.length; i++) {
//     if (value[i] === '{') {
//       braceCount++;
//     } else if (value[i] === '}') {
//       braceCount--;
//       if (braceCount === 0) {
//         endIndex = i + 1;
//         break;
//       }
//     }
//   }

//   // Ensure the function name is part of the result
//   const functionData = value.slice(startIndex, endIndex).trim();
//   console.log('data',getFunctionData);
//   console.log('type',functionType);
//   return { data: functionData, type: functionType };
// }


// export function extractFunctionsByNames(value, functionNames) {
//   const functionPatterns = {
//     // JavaScript (ES6+)
//     async_arrow_function: (name) => new RegExp(`async\\s+const\\s+${name}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
//     arrow_function: (name) => new RegExp(`const\\s+${name}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
//     regular_function: (name) => new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
//     class_method: (name) => new RegExp(`\\b${name}\\s*\\(([^)]*)\\)\\s*{[^}]*}`, 's'),
//     interface: (name) => new RegExp(`interface\\s+${name}\\s*{[^}]*}`, 's'),
//     // TypeScript 
//     ts_arrow_function: (name) => new RegExp(`const\\s+${name}:\\s*\\([^)]*\\)\\s*=>\\s*[^=]*=\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
//     ts_async_arrow_function: (name) => new RegExp(`const\\s+${name}:\\s*\\([^)]*\\)\\s*=>\\s*Promise<[^>]*>\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
//     ts_regular_function: (name) => new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*:\\s*[^\\s]*\\s*{[^}]*}`, 's'),
//     ts_async_regular_function: (name) => new RegExp(`async\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*:\\s*Promise<[^>]*>\\s*{[^}]*}`, 's'),
//     // Java
//     java_method: (name) => new RegExp(`(public|protected|private|static|final|abstract)?\\s*\\w+\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     java_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
//     java_constructor: (name) => new RegExp(`(public|protected|private)?\\s*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     java_interface: (name) => new RegExp(`interface\\s+${name}\\s*{[^}]*}`, 's'),
//     java_enum: (name) => new RegExp(`enum\\s+${name}\\s*{[^}]*}`, 's'),
//     java_abstract_class: (name) => new RegExp(`abstract\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
//     // Kotlin
//     kotlin_function: (name) => new RegExp(`(public|private|protected|internal|override|abstract)?\\s*(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*:\\s*\\w*\\s*\\{[^}]*}`, 's'),
//     kotlin_constructor: (name) => new RegExp(`constructor\\s*\\([^)]*\\)\\s*\\{[^}]*}`, 's'),
//     kotlin_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
//     kotlin_interface: (name) => new RegExp(`interface\\s+${name}\\s*{[^}]*}`, 's'),
//     kotlin_data_class: (name) => new RegExp(`data\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
//     kotlin_abstract_class: (name) => new RegExp(`abstract\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
//     kotlin_enum_class: (name) => new RegExp(`enum\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
//     // C#
//     csharp_method: (name) => new RegExp(`(public|private|protected|static|virtual|override)?\\s+\\w+\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     csharp_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
//     // C
//     c_function: (name) => new RegExp(`(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     c_struct: (name) => new RegExp(`struct\\s+${name}\\s*{[^}]*}`, 's'),
//     c_method: (name) => new RegExp(`(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     // C++
//     cpp_method: (name) => new RegExp(`(public|protected|private)?\\s*(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     cpp_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
//     // PHP
//     php_function: (name) => new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     php_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
//     php_method: (name) => new RegExp(`public\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     // Python
//     python_function: (name) => new RegExp(`def\\s+${name}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
//     python_class: (name) => new RegExp(`class\\s+${name}\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
//     python_method: (name) => new RegExp(`def\\s+${name}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
//     // Anonymous JavaScript Function Expression
//     anonymous_function_expr: () => new RegExp(`function\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//     // Anonymous Arrow Function
//     anonymous_arrow_function: () => new RegExp(`\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),
//     // Anonymous Async Arrow Function
//     anonymous_async_arrow_function: () => new RegExp(`async\\s*\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),
//   };

//   const results = [];

//   for (const functionName of functionNames) {
//     let functionFound = false;

//     // Check each pattern for the current function name
//     for (const [type, patternFunc] of Object.entries(functionPatterns)) {
//       const pattern = patternFunc(functionName);
//       const match = value.match(pattern);
      
//       if (match) {
//         results.push(match[0].trim());
//         functionFound = true;
//         break;  // If a function is found, no need to check other patterns for this name
//       }
//     }

//     // If the function was not found, push a null or some indication
//     if (!functionFound) {
//       results.push(null);
//     }
//   }

//   return results;
// }





// function getNameFromDeclaration(str) {
//   const patterns = [
//     // JavaScript and TypeScript functions, including async and arrow functions
//     /function\s+([a-zA-Z0-9_$]+)\s*\(/,                              // Regular function
//     /const\s+([a-zA-Z0-9_$]+)\s*=\s*\([^)]*\)\s*=>\s*{/,             // Arrow function
//     /async\s+function\s+([a-zA-Z0-9_$]+)\s*\(/,                      // Async function
//     /async\s+const\s+([a-zA-Z0-9_$]+)\s*=\s*async\s*\([^)]*\)\s*=>\s*{/,  // Async arrow function
//     /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // Class
//     /([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,                              // Class method
//     /interface\s+([a-zA-Z0-9_$]+)\s*{/,                              // Interface
//     /enum\s+([a-zA-Z0-9_$]+)\s*{/,                                   // Enum

//     // Java methods and classes
//     /(public|protected|private|static|final|abstract)?\s*\w+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,  // Java method
//     /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // Java class
//     /(public|protected|private)?\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/, // Java constructor

//     // Python functions and classes
//     /def\s+([a-zA-Z0-9_$]+)\s*\(/,                                   // Python function
//     /class\s+([a-zA-Z0-9_$]+)\s*:/,                                  // Python class

//     // C and C++ functions and classes
//     /([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,                              // C/C++ function
//     /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // C++ class

//     // C# methods and classes
//     /(public|private|protected|static|virtual|override)?\s*\w+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,  // C# method
//     /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // C# class

//     // PHP functions and classes
//     /function\s+([a-zA-Z0-9_$]+)\s*\(/,                              // PHP function
//     /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // PHP class
//   ];

//   for (const pattern of patterns) {
//     const match = str.match(pattern);
//     if (match) {
//       return match[1] || match[2];
//     }
//   }

//   return null;
// }


// function extractFunctionsAtLine(code, lineNumber) {
//     const lines = code.split('\n');
//     const functions = [];
//     const stack = [];

//     // Regular expressions to match different types of functions
//     const functionPatterns = {
//     // JavaScript/TypeScript Patterns
//     regular_function: /function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Named function
//     anonymous_function_expr: /function\s*\([^)]*\)\s*{/,                     // Anonymous function expression
//     arrow_function: /\([^)]*\)\s*=>\s*{/,                                    // Arrow function
//     async_arrow_function: /async\s*\([^)]*\)\s*=>\s*{/,                      // Async arrow function
//     class_method: /[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,                // Class method
//     class: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,               // Class declaration
//     interface: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,       // Interface declaration
//     enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,                 // Enum declaration

//     // Java Patterns
//     oops_method: /(public|protected|private|static|final|abstract)?\s*\w+\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Java method
//     oops_enum: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // Java enum declaration

//     // Python Patterns
//     python_function: /def\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*:/,        // Python function definition
//     python_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*:/,         // Python class declaration

//     // C/C++ Patterns
//     cpp_function: /[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,                 // C/C++ function
//     cpp_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,            // C++ class declaration
//     cpp_struct_declaration: /struct\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,          // C/C++ struct declaration
//     cpp_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,              // C/C++ enum declaration

//     // C# Patterns
//     csharp_method: /(public|private|protected|static|virtual|override)?\s*\w+\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // C# method
//     csharp_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,          // C# class declaration
//     csharp_interface_declaration: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,  // C# interface declaration
//     csharp_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,            // C# enum declaration

//     // PHP Patterns
//     php_function: /function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,       // PHP function definition
//     php_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // PHP class declaration
//     php_interface_declaration: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,     // PHP interface declaration
//     php_trait: /trait\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // PHP trait declaration

//     // Swift Patterns
//     swift_function: /func\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,         // Swift function definition
//     swift_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,           // Swift class declaration
//     swift_struct_declaration: /struct\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,         // Swift struct declaration
//     swift_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // Swift enum declaration
//     swift_protocol_declaration: /protocol\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,     // Swift protocol declaration
// };

//     for (let i = 0; i < lines.length; i++) {
//         const line = lines[i];
//         const trimmedLine = line.trim();

//         // Check for the start of a function using regular expressions
//         const isFunctionStart = Object.values(functionPatterns).some(pattern => pattern.test(trimmedLine));

//         if (isFunctionStart) {
//             // Push a new function onto the stack
//             stack.push({
//                 start: i,
//                 lines: [line],
//                 braceCount: (line.match(/{/g) || []).length - (line.match(/}/g) || []).length
//             });
//         } else if (stack.length > 0) {
//             // If inside a function, add the line to the current function's lines
//             stack[stack.length - 1].lines.push(line);
//             // Update brace count
//             stack[stack.length - 1].braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
//         }

//         // Check if the current function scope has ended
//         while (stack.length > 0 && stack[stack.length - 1].braceCount <= 0) {
//             const func = stack.pop();
//             func.end = i;
//             func.code = func.lines.join('\n');
//             functions.push(func);
//         }
//     }

//     // After processing all lines, identify the relevant functions
//     let thisFunction = null;
//     let upperFunction = null;
//     let belowFunction = null;

//     for (const func of functions) {
//         // Identify the function that contains the line number
//         if (func.start <= lineNumber && func.end >= lineNumber) {
//             // Choose the innermost function (with the highest start line)
//             if (!thisFunction || func.start > thisFunction.start) {
//                 thisFunction = func;
//             }
//         }
//     }

//     // Identify the upperFunction: the closest function ending before the line number
//     for (const func of functions) {
//         if (func.end < lineNumber) {
//             if (!upperFunction || func.end > upperFunction.end) {
//                 upperFunction = func;
//             }
//         }
//     }

//     // Identify the belowFunction: the closest function starting after the line number
//     for (const func of functions) {
//         if (func.start > lineNumber) {
//             if (!belowFunction || func.start < belowFunction.start) {
//                 belowFunction = func;
//             }
//         }
//     }

//     return {
//         upperFunction: upperFunction ? upperFunction.code.trim() : 'No upper function found',
//         thisFunction: thisFunction ? thisFunction.code.trim() : 'Cursor not in any function',
//         belowFunction: belowFunction ? belowFunction.code.trim() : 'No below function found'
//     };
// }

// function escapeTemplateString(str) {
//   return str
//     .replace(/\${/g, '\\${')  // Escape ${ by adding \
//     .replace(/\`/g, '\\`')    // Escape ` by adding \
//     .replace(/\$/g, '\\$');   // Escape $ by adding \
// }

// export const getFunctionData = (value , line , target = 'this')=>{
//   const escapedStr = escapeTemplateString(value);
//   // console.log('escapedStr',escapedStr);

//   // console.log('value',value);
//   console.log('line',line);
//   let extractedFunctionName = extractFunctionsAtLine(value, line);
//   console.log('extractFunctionanme',extractedFunctionName);
//   let notNullFunction = null ;
//   let targetedFunc = '';
//   if(extractedFunctionName.thisFunction != null) {
//     targetedFunc = 'this';
//     notNullFunction = extractedFunctionName.thisFunction ;
//   }else if(extractedFunctionName.belowFunction != null){
//     targetedFunc = 'down';
//     notNullFunction = extractedFunctionName.belowFunction ;
//   }else if(extractedFunctionName.upperFunction != null){
//     targetedFunc = 'up' ;
//     notNullFunction = extractedFunctionName.upperFunction ;
//   }

//   switch (target) {
//     case 'up':
//       extractedFunctionName = extractedFunctionName.upperFunction ;
//       break;
//     case 'down':
//       extractedFunctionName = extractedFunctionName.belowFunction ;
//       break;
//     case 'this':
//       extractedFunctionName = extractedFunctionName.thisFunction ;
//       break;
//     default:
//       extractedFunctionName = null ;
//   }

// if(extractedFunctionName == null)
//   extractedFunctionName = notNullFunction ;

// if(!extractedFunctionName)
//   return null;

// const function_name = getNameFromDeclaration(extractedFunctionName);
// const function_data = extractFunctionByName(value,function_name);
// console.log('function_name',function_name);
// console.log('function_data',function_data);

// // if not function name but data that means may be that anynomyous function 
// if(function_name == null && extractedFunctionName)
//   return {'data': extractedFunctionName ,'target':targetedFunc , 'type':function_data.type};
  
  
//   return {'data': function_data.data ,'target':targetedFunc , 'type':function_data.type};
//     };


// // // // CALLING ======================>
// // const fD = getFunctionData(values,9,'this'); // value | line | up down this
// // // // return  => [data , target , type]
// // console.log(fD.data);
// // console.log(fD.target);
// // console.log(fD.type);




const values = `// Function to check if a number is prime
function(a, b) {
    return a + b;
    
}

function isPrime(num) {
  if (num < 2) {
    return false;
  }
  for (let i = 2; i <= Math.sqrt(num); i++) {
    if (num % i === 0) {
      return false;
    }
  }
  return true;
}

// Function to calculate the square root of a number
function squareRoot(num) {
  function innerFunctionGcd(a, b) {
  if (b === 0) {
    return a;
  } else {
    return gcd(b, a % b);
  }
  }
  if (num < 0) {
    throw new Error('Input must be non-negative');
  }
  if (num === 0 || num === 1) {
    return num;
  }
  let low = 1;
  let high = num;
  while (low <= high) {
    let mid = Math.floor((low + high) / 2);
    if (mid * mid === num) {
      return mid;
    } else if (mid * mid < num) {
      low = mid + 1;
      continue;
    } else {
      high = mid - 1;
    }
  }
  return low - 1;
}
const armadilo = () =>{
  console.log('hello world');
}
`;


export async function extractFunctionByName(value, functionName) {
  // Patterns for both regular functions, arrow functions, and class methods
  // console.log('EXTRACTFUNCTIONBYNAME _______________]',value);
  const functionPatterns = {
    // JavaScript (ES6+)
    // Async function declaration
    async_function: new RegExp(`async\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
       // regular_function
    regular_function: new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    // async_arrow_function
    async_arrow_function: new RegExp(`async\\s+const\\s+${functionName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
    // arrow_function
    arrow_function: new RegExp(`\\s+const\\s+${functionName}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
       // Async method shorthand in a class
    async_class_method: new RegExp(`async\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    // async_method
    async_method: new RegExp(`${functionName}\\s*:\\s*async\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    //   Anonymous Async Arrow Function
    // anonymous_async_arrow_function: new RegExp(`async\\s*\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),

    // class 
    class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
    // class_method
    class_method: new RegExp(`\\b${functionName}\\s*\\(([^)]*)\\)\\s*{[^}]*}`, 's'),
    // interface
    interface: new RegExp(`interface\\s+${functionName}\\s*{[^}]*}`, 's') ,
    // TypeScript 
    ts_async_arrow_function: new RegExp(`const\\s+${functionName}:\\s*\\([^)]*\\)\\s*=>\\s*Promise<[^>]*>\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
    ts_async_regular_function: new RegExp(`async\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*:\\s*Promise<[^>]*>\\s*{[^}]*}`, 's'),
    ts_arrow_function: new RegExp(`const\\s+${functionName}:\\s*\\([^)]*\\)\\s*=>\\s*[^=]*=\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
    ts_regular_function: new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*:\\s*[^\\s]*\\s*{[^}]*}`, 's'),
    // Java
    java_method: new RegExp(`(public|protected|private|static|final|abstract)?\\s*\\w+\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    java_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
    java_constructor: new RegExp(`(public|protected|private)?\\s*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    java_interface: new RegExp(`interface\\s+${functionName}\\s*{[^}]*}`, 's'),
      java_enum: new RegExp(`enum\\s+${functionName}\\s*{[^}]*}`, 's'),
    java_abstract_class: new RegExp(`abstract\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
    // Kotlin Method
    kotlin_function: new RegExp(`(public|private|protected|internal|override|abstract)?\\s*(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*:\\s*\\w*\\s*\\{[^}]*}`, 's'),
    kotlin_constructor: new RegExp(`constructor\\s*\\([^)]*\\)\\s*\\{[^}]*}`, 's'),
    kotlin_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
    kotlin_interface: new RegExp(`interface\\s+${functionName}\\s*{[^}]*}`, 's'),
    kotlin_data_class: new RegExp(`data\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
    kotlin_abstract_class: new RegExp(`abstract\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
    kotlin_enum_class: new RegExp(`enum\\s+class\\s+${functionName}\\s*{[^}]*}`, 's'),
    // C#
    csharp_method: new RegExp(`(public|private|protected|static|virtual|override)?\\s+\\w+\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    csharp_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
    
    // C
    c_function: new RegExp(`(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    c_struct: new RegExp(`struct\\s+${functionName}\\s*{[^}]*}`, 's'),
    c_method: new RegExp(`(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    // C++
    cpp_method: new RegExp(`(public|protected|private)?\\s*(\\w+\\s+)*${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    cpp_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's') ,
    // PHP
    php_function: new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    php_class: new RegExp(`class\\s+${functionName}\\s*{[^}]*}`, 's'),
    php_method: new RegExp(`public\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),

    // Python
    python_function: new RegExp(`def\\s+${functionName}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
    python_class: new RegExp(`class\\s+${functionName}\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
    python_method: new RegExp(`def\\s+${functionName}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
        //Anonymous JavaScript Function Expression
    anonymous_function_expr: new RegExp(`function\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
//   Anonymous Arrow Function
    anonymous_arrow_function: new RegExp(`\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),
};


  let functionType = null;
  let startIndex = -1;
  let braceCount = 0;
  let endIndex = -1;

  // Check patterns to find the type and start index
  for (const [type, pattern] of Object.entries(functionPatterns)) {
    const matchStart = value.match(pattern);
    if (matchStart) {
      functionType = type;
      startIndex = matchStart.index;
      break;
    }
  }

  if (!functionType) return { data: null, type: null }; // Return null if the function is not found

  // Iterate over the string starting from the function's opening brace
  for (let i = startIndex; i < value.length; i++) {
    if (value[i] === '{') {
      braceCount++;
    } else if (value[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  // Ensure the function name is part of the result
  const functionData = value.slice(startIndex, endIndex).trim();
  // console.log('data',getFunctionData);
  // console.log('type',functionType);
  return { data: functionData, type: functionType };
}


export function extractFunctionsByNames(value, functionNames) {
  const functionPatterns = {
    // JavaScript (ES6+)
    async_arrow_function: (name) => new RegExp(`async\\s+const\\s+${name}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
    arrow_function: (name) => new RegExp(`const\\s+${name}\\s*=\\s*\\(([^)]*)\\)\\s*=>\\s*{[^}]*}`, 's'),
    regular_function: (name) => new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
    class_method: (name) => new RegExp(`\\b${name}\\s*\\(([^)]*)\\)\\s*{[^}]*}`, 's'),
    interface: (name) => new RegExp(`interface\\s+${name}\\s*{[^}]*}`, 's'),
    // TypeScript 
    ts_arrow_function: (name) => new RegExp(`const\\s+${name}:\\s*\\([^)]*\\)\\s*=>\\s*[^=]*=\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
    ts_async_arrow_function: (name) => new RegExp(`const\\s+${name}:\\s*\\([^)]*\\)\\s*=>\\s*Promise<[^>]*>\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*{[^}]*}`, 's'),
    ts_regular_function: (name) => new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*:\\s*[^\\s]*\\s*{[^}]*}`, 's'),
    ts_async_regular_function: (name) => new RegExp(`async\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*:\\s*Promise<[^>]*>\\s*{[^}]*}`, 's'),
    // Java
    java_method: (name) => new RegExp(`(public|protected|private|static|final|abstract)?\\s*\\w+\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    java_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
    java_constructor: (name) => new RegExp(`(public|protected|private)?\\s*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    java_interface: (name) => new RegExp(`interface\\s+${name}\\s*{[^}]*}`, 's'),
    java_enum: (name) => new RegExp(`enum\\s+${name}\\s*{[^}]*}`, 's'),
    java_abstract_class: (name) => new RegExp(`abstract\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
    // Kotlin
    kotlin_function: (name) => new RegExp(`(public|private|protected|internal|override|abstract)?\\s*(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*:\\s*\\w*\\s*\\{[^}]*}`, 's'),
    kotlin_constructor: (name) => new RegExp(`constructor\\s*\\([^)]*\\)\\s*\\{[^}]*}`, 's'),
    kotlin_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
    kotlin_interface: (name) => new RegExp(`interface\\s+${name}\\s*{[^}]*}`, 's'),
    kotlin_data_class: (name) => new RegExp(`data\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
    kotlin_abstract_class: (name) => new RegExp(`abstract\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
    kotlin_enum_class: (name) => new RegExp(`enum\\s+class\\s+${name}\\s*{[^}]*}`, 's'),
    // C#
    csharp_method: (name) => new RegExp(`(public|private|protected|static|virtual|override)?\\s+\\w+\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    csharp_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
    // C
    c_function: (name) => new RegExp(`(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    c_struct: (name) => new RegExp(`struct\\s+${name}\\s*{[^}]*}`, 's'),
    c_method: (name) => new RegExp(`(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    // C++
    cpp_method: (name) => new RegExp(`(public|protected|private)?\\s*(\\w+\\s+)*${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    cpp_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
    // PHP
    php_function: (name) => new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    php_class: (name) => new RegExp(`class\\s+${name}\\s*{[^}]*}`, 's'),
    php_method: (name) => new RegExp(`public\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    // Python
    python_function: (name) => new RegExp(`def\\s+${name}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
    python_class: (name) => new RegExp(`class\\s+${name}\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
    python_method: (name) => new RegExp(`def\\s+${name}\\s*\\([^)]*\\)\\s*:([\\s\\S]*?)(?=\\n\\S|$)`, 's'),
    // Anonymous JavaScript Function Expression
    anonymous_function_expr: () => new RegExp(`function\\s*\\([^)]*\\)\\s*{[^}]*}`, 's'),
    // Anonymous Arrow Function
    anonymous_arrow_function: () => new RegExp(`\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),
    // Anonymous Async Arrow Function
    anonymous_async_arrow_function: () => new RegExp(`async\\s*\\(\\s*[^)]*\\s*\\)\\s*=>\\s*{[^}]*}`, 's'),
  };

  const results = [];

  for (const functionName of functionNames) {
    let functionFound = false;

    // Check each pattern for the current function name
    for (const [type, patternFunc] of Object.entries(functionPatterns)) {
      const pattern = patternFunc(functionName);
      const match = value.match(pattern);
      
      if (match) {
        results.push(match[0].trim());
        functionFound = true;
        break;  // If a function is found, no need to check other patterns for this name
      }
    }

    // If the function was not found, push a null or some indication
    if (!functionFound) {
      results.push(null);
    }
  }

  return results;
}





function getNameFromDeclaration(str) {
  const patterns = [
    // JavaScript and TypeScript functions, including async and arrow functions
    /async\s+function\s+([a-zA-Z0-9_$]+)\s*\(/,                      // Async function
    /async\s+const\s+([a-zA-Z0-9_$]+)\s*=\s*async\s*\([^)]*\)\s*=>\s*{/,  // Async arrow function
    /function\s+([a-zA-Z0-9_$]+)\s*\(/,                              // Regular function
    /const\s+([a-zA-Z0-9_$]+)\s*=\s*\([^)]*\)\s*=>\s*{/,             // Arrow function
    /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // Class
    /([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,                              // Class method
    /interface\s+([a-zA-Z0-9_$]+)\s*{/,                              // Interface
    /enum\s+([a-zA-Z0-9_$]+)\s*{/,                                   // Enum

    // Java methods and classes
    /(public|protected|private|static|final|abstract)?\s*\w+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,  // Java method
    /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // Java class
    /(public|protected|private)?\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/, // Java constructor

    // Python functions and classes
    /def\s+([a-zA-Z0-9_$]+)\s*\(/,                                   // Python function
    /class\s+([a-zA-Z0-9_$]+)\s*:/,                                  // Python class

    // C and C++ functions and classes
    /([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,                              // C/C++ function
    /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // C++ class

    // C# methods and classes
    /(public|private|protected|static|virtual|override)?\s*\w+\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*{/,  // C# method
    /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // C# class

    // PHP functions and classes
    /function\s+([a-zA-Z0-9_$]+)\s*\(/,                              // PHP function
    /class\s+([a-zA-Z0-9_$]+)\s*{/,                                  // PHP class
  ];

  for (const pattern of patterns) {
    const match = str.match(pattern);
    if (match) {
      return match[1] || match[2];
    }
  }

  return null;
}


// function extractFunctionsAtLine(code, lineNumber) {
//   // console.log('EXTRACTFUNCTIONSATLINE___________]');
//     const lines = code.split('\n');
//     const functions = [];
//     const stack = [];
//     // Regular expressions to match different types of functions
//     const functionPatterns = {
//     // JavaScript/TypeScript Patterns
//     async_function: /async\s+function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/, // Async named function
//     regular_function: /function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Named function
    
    
//     async_arrow_function: /async\s*\([^)]*\)\s*=>\s*{/,                      // Async arrow function
//     arrow_function: /\([^)]*\)\s*=>\s*{/,                                    // Arrow function
    
//     async_class_method: /async\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Async class method
//     class_method: /[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,                // Class method
//     class: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,               // Class declaration
//     anonymous_function_expr: /function\s*\([^)]*\)\s*{/,                     // Anonymous function expression
//     interface: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,       // Interface declaration
//     enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,                 // Enum declaration

//     // Java Patterns
//     oops_method: /(public|protected|private|static|final|abstract)?\s*\w+\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Java method
//     oops_enum: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // Java enum declaration

//     // Python Patterns
//     python_function: /def\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*:/,        // Python function definition
//     python_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*:/,         // Python class declaration

//     // C/C++ Patterns
//     cpp_function: /[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,                 // C/C++ function
//     cpp_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,            // C++ class declaration
//     cpp_struct_declaration: /struct\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,          // C/C++ struct declaration
//     cpp_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,              // C/C++ enum declaration

//     // C# Patterns
//     csharp_method: /(public|private|protected|static|virtual|override)?\s*\w+\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // C# method
//     csharp_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,          // C# class declaration
//     csharp_interface_declaration: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,  // C# interface declaration
//     csharp_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,            // C# enum declaration

//     // PHP Patterns
//     php_function: /function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,       // PHP function definition
//     php_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // PHP class declaration
//     php_interface_declaration: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,     // PHP interface declaration
//     php_trait: /trait\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // PHP trait declaration

//     // Swift Patterns
//     swift_function: /func\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,         // Swift function definition
//     swift_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,           // Swift class declaration
//     swift_struct_declaration: /struct\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,         // Swift struct declaration
//     swift_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // Swift enum declaration
//     swift_protocol_declaration: /protocol\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,     // Swift protocol declaration
// };

//     for (let i = 0; i < lines.length; i++) {
//         const line = lines[i];
//         const trimmedLine = line.trim();

//         // Check for the start of a function using regular expressions
//         const isFunctionStart = Object.values(functionPatterns).some(pattern => pattern.test(trimmedLine));

//         if (isFunctionStart) {
//             // Push a new function onto the stack
//             stack.push({
//                 start: i,
//                 lines: [line],
//                 braceCount: (line.match(/{/g) || []).length - (line.match(/}/g) || []).length
//             });
//         } else if (stack.length > 0) {
//             // If inside a function, add the line to the current function's lines
//             stack[stack.length - 1].lines.push(line);
//             // Update brace count
//             stack[stack.length - 1].braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
//         }

//         // Check if the current function scope has ended
//         while (stack.length > 0 && stack[stack.length - 1].braceCount <= 0) {
//             const func = stack.pop();
//             func.end = i;
//             func.code = func.lines.join('\n');
//             functions.push(func);
//         }
//     }

//     // After processing all lines, identify the relevant functions
//     let thisFunction = null;
//     let upperFunction = null;
//     let belowFunction = null;

//     for (const func of functions) {
//         // Identify the function that contains the line number
//         if (func.start <= lineNumber && func.end >= lineNumber) {
//             // Choose the innermost function (with the highest start line)
//             if (!thisFunction || func.start > thisFunction.start) {
//                 thisFunction = func;
//             }
//         }
//     }

//     // Identify the upperFunction: the closest function ending before the line number
//     for (const func of functions) {
//         if (func.end < lineNumber) {
//             if (!upperFunction || func.end > upperFunction.end) {
//                 upperFunction = func;
//             }
//         }
//     }

//     // Identify the belowFunction: the closest function starting after the line number
//     for (const func of functions) {
//         if (func.start > lineNumber) {
//             if (!belowFunction || func.start < belowFunction.start) {
//                 belowFunction = func;
//             }
//         }
//     }

//     return {
//         upperFunction: upperFunction ? upperFunction.code.trim() : null,
//         thisFunction: thisFunction ? thisFunction.code.trim() : null,
//         belowFunction: belowFunction ? belowFunction.code.trim() : null
//     };
//     // return {
//     //     upperFunction: upperFunction ? upperFunction.code.trim() : 'No upper function found',
//     //     thisFunction: thisFunction ? thisFunction.code.trim() : 'Cursor not in any function',
//     //     belowFunction: belowFunction ? belowFunction.code.trim() : 'No below function found'
//     // };
// }

// below function fix ??? 
function getFunctionNameFromDeclaration(str) {
    // Step 1: Remove keywords like 'function', 'async', 'export', etc.
    str = str.replace(/\b(function|async|export)\b/g, '').trim();

    // Step 2: Remove parameters in parentheses and curly braces
    str = str.replace(/\(.*?\)/g, '').replace(/{.*?}/g, '').trim();

    // Step 3: Extract the first word (function/keyword name)
    let match = str.match(/^\w+/);
    return match ? match[0] : null;
}

		// please check below function ???



function extractFunctionsAtLine(code, lineNumber) {
    const lines = code.split('\n');
    const functions = [];
    const stack = [];

    const reservedKeywords = new Set([
        "break", "case", "catch", "class", "const", "continue", "debugger", "default",
        "delete", "do", "else", "enum", "export", "extends", "finally", "for", "function",
        "if", "import", "in", "instanceof", "let", "new", "return", "super", "switch",
        "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield"
    ]);

    const functionPatterns = {
    // JavaScript/TypeScript Patterns
    async_function: /async\s+function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/, // Async named function
    regular_function: /function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Named function
    
    
    async_arrow_function: /async\s*\([^)]*\)\s*=>\s*{/,                      // Async arrow function
    arrow_function: /\([^)]*\)\s*=>\s*{/,                                    // Arrow function
    
    async_class_method: /async\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Async class method
    class_method: /[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,                // Class method
    class: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,               // Class declaration
    anonymous_function_expr: /function\s*\([^)]*\)\s*{/,                     // Anonymous function expression
    interface: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,       // Interface declaration
    enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,                 // Enum declaration

    // Java Patterns
    oops_method: /(public|protected|private|static|final|abstract)?\s*\w+\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // Java method
    oops_enum: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // Java enum declaration

    // Python Patterns
    python_function: /def\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*:/,        // Python function definition
    python_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*:/,         // Python class declaration

    // C/C++ Patterns
    cpp_function: /[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,                 // C/C++ function
    cpp_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,            // C++ class declaration
    cpp_struct_declaration: /struct\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,          // C/C++ struct declaration
    cpp_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,              // C/C++ enum declaration

    // C# Patterns
    csharp_method: /(public|private|protected|static|virtual|override)?\s*\w+\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,  // C# method
    csharp_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,          // C# class declaration
    csharp_interface_declaration: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,  // C# interface declaration
    csharp_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,            // C# enum declaration

    // PHP Patterns
    php_function: /function\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,       // PHP function definition
    php_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // PHP class declaration
    php_interface_declaration: /interface\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,     // PHP interface declaration
    php_trait: /trait\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // PHP trait declaration

    // Swift Patterns
    swift_function: /func\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*\([^)]*\)\s*{/,         // Swift function definition
    swift_class_declaration: /class\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,           // Swift class declaration
    swift_struct_declaration: /struct\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,         // Swift struct declaration
    swift_enum_declaration: /enum\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,             // Swift enum declaration
    swift_protocol_declaration: /protocol\s+[a-zA-Z_$][0-9a-zA-Z_$]*\s*{/,     // Swift protocol declaration
};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Check for the start of a function using regular expressions
        const matchingPattern = Object.values(functionPatterns).find(pattern => pattern.test(trimmedLine));
        if (matchingPattern) {
            const match = trimmedLine.match(matchingPattern);
            
            console.log('match :',match);
            // console.log('match[1] :',match[1]);
            // const functionName = match && match[1]; // Capture the function name (if available)
            const functionName = getFunctionNameFromDeclaration(match[0]);
            
            // Check if function name is a reserved keyword
            console.log('continue 1:',functionName);
            if (functionName && reservedKeywords.has(functionName)) {
              console.log('continue 2:',functionName);
                continue; // Ignore this line if the name is a reserved keyword
            }

            // Push a new function onto the stack
            stack.push({
                start: i,
                lines: [line],
                braceCount: (line.match(/{/g) || []).length - (line.match(/}/g) || []).length
            });
        } else if (stack.length > 0) {
            // If inside a function, add the line to the current function's lines
            stack[stack.length - 1].lines.push(line);
            // Update brace count
            stack[stack.length - 1].braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        }

        // Check if the current function scope has ended
        while (stack.length > 0 && stack[stack.length - 1].braceCount <= 0) {
            const func = stack.pop();
            func.end = i;
            func.code = func.lines.join('\n');
            functions.push(func);
        }
    }

    // After processing all lines, identify the relevant functions
    let thisFunction = null;
    let upperFunction = null;
    let belowFunction = null;

    for (const func of functions) {
        // Identify the function that contains the line number
        if (func.start <= lineNumber && func.end >= lineNumber) {
            // Choose the innermost function (with the highest start line)
            if (!thisFunction || func.start > thisFunction.start) {
                thisFunction = func;
            }
        }
    }

    // Identify the upperFunction: the closest function ending before the line number
    for (const func of functions) {
        if (func.end < lineNumber) {
            if (!upperFunction || func.end > upperFunction.end) {
                upperFunction = func;
            }
        }
    }

    // Identify the belowFunction: the closest function starting after the line number
    for (const func of functions) {
        if (func.start > lineNumber) {
            if (!belowFunction || func.start < belowFunction.start) {
                belowFunction = func;
            }
        }
    }

    return {
        upperFunction: upperFunction ? upperFunction.code.trim() : null,
        thisFunction: thisFunction ? thisFunction.code.trim() : null,
        belowFunction: belowFunction ? belowFunction.code.trim() : null
    };
}



function escapeTemplateString(str) {
  return str
    .replace(/\${/g, '\\${')  // Escape ${ by adding \
    .replace(/\`/g, '\\`')    // Escape ` by adding \
    .replace(/\$/g, '\\$');   // Escape $ by adding \
}

export const getFunctionData = async (value , line , target = 'this')=>{
  // console.log('GETFUNCTIONDATA ______________]');
  const escapedStr = escapeTemplateString(value);
  
  // console.log('escapedStr',escapedStr);
  // console.log('value',value);
  // console.log('line',line);
  // console.log('target',target);
  
  let extractedFunctionName = extractFunctionsAtLine(value, line);
  console.log('extractFunctionanme',extractedFunctionName);
  let notNullFunction = null ;
  let targetedFunc = '';
  if(extractedFunctionName.thisFunction != null) {
    targetedFunc = 'this';
    notNullFunction = extractedFunctionName.thisFunction ;
  }else if(extractedFunctionName.belowFunction != null){
    targetedFunc = 'down';
    notNullFunction = extractedFunctionName.belowFunction ;
  }else if(extractedFunctionName.upperFunction != null){
    targetedFunc = 'up' ;
    notNullFunction = extractedFunctionName.upperFunction ;
  }

  switch (target) {
    case 'up':
      extractedFunctionName = extractedFunctionName.upperFunction ;
      break;
    case 'down':
      extractedFunctionName = extractedFunctionName.belowFunction ;
      break;
    case 'this':
      extractedFunctionName = extractedFunctionName.thisFunction ;
      break;
    default:
      extractedFunctionName = null ;
  }

if(extractedFunctionName == null)
  extractedFunctionName = notNullFunction ;

if(!extractedFunctionName){
  return null;
}


const function_name = getNameFromDeclaration(extractedFunctionName);
const function_data = await extractFunctionByName(value,function_name);
// console.log('function_name',function_name);
// console.log('function_data',function_data);

// if not function name but data that means may be that anynomyous function  ???
if(function_name == null && extractedFunctionName)
  return {'data': extractedFunctionName ,'target':targetedFunc , 'type':function_data.type};
  
  
  return {'data': function_data.data ,'target':targetedFunc , 'type':function_data.type};
    };


// // // CALLING ======================>
// const fD = getFunctionData(values,9,'this'); // value | line | up down this
// // // return  => [data , target , type]
// console.log(fD.data);
// console.log(fD.target);
// console.log(fD.type);

