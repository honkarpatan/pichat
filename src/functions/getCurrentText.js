export function trackTypingSentence(editor) {
    let currentLineContent = '';  // This will store the current sentence being typed.
    let currentRow = -1;  // To keep track of the row where typing is happening.

    // Function to start tracking changes in the editor
    function startTracking() {
        editor.session.on('change', function(delta) {
            const { action, start } = delta;
            
            // Check if we are typing on the same row or need to initialize for a new row
            if (start.row === currentRow || currentRow === -1) {
                currentRow = start.row;  // Update the current row being typed on

                // Update the current line content based on the action
                if (action === 'insert' || action === 'remove') {
                    currentLineContent = editor.session.getLine(currentRow);
                }

                // console.log('Current typing sentence:', currentLineContent);
            }
        });
    }

    // Call the startTracking function to begin listening to changes
    startTracking();

    // Return a function to get the current line content anytime
    return function getCurrentTypingSentence() {
        return currentLineContent;
    };
}