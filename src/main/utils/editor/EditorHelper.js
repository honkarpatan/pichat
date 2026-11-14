export class EditorHelper {
    static getEditor() {
        return window.editorManager?.editor;
    }

    // Get full text from editor
    static getValue() {
        const editor = this.getEditor();
        if (!editor) return '';
        
        // Acode's compatibility wrapper or Ace
        if (typeof editor.getValue === 'function') return editor.getValue();
        // Native CM6 fallback
        if (editor.state) return editor.state.doc.toString();
        
        return '';
    }

    // Get highlighted/selected text
    static getSelectedText() {
        const editor = this.getEditor();
        if (!editor) return '';
        
        // Ace API
        if (typeof editor.getSelectedText === 'function') return editor.getSelectedText();
        
        // CM6 API
        if (editor.state) {
            const selection = editor.state.selection.main;
            return editor.state.sliceDoc(selection.from, selection.to);
        }
        return '';
    }

    // Get current line number (0-indexed)
    static getCursorRow() {
        const editor = this.getEditor();
        if (!editor) return 0;
        
        // Ace API
        if (editor.selection && typeof editor.selection.getCursor === 'function') {
            return editor.selection.getCursor().row;
        }
        
        // CM6 API
        if (editor.state) {
            const pos = editor.state.selection.main.head;
            return editor.state.doc.lineAt(pos).number - 1; // 0-indexed for consistency
        }
        return 0;
    }

    // Get File Language/Mode
    static getLanguage() {
        const activeFile = window.editorManager?.activeFile;
        if (!activeFile) return 'text';
        
        // Ace uses session mode
        if (activeFile.session && activeFile.session.$modeId) {
            return activeFile.session.$modeId.split('/').pop();
        }
        
        // CM6 / Universal Fallback based on extension
        if (activeFile.name) {
            const ext = activeFile.name.split('.').pop();
            return ext || 'text';
        }
        return 'text';
    }

    // Insert Text at Cursor
    static insertText(text) {
        const editor = this.getEditor();
        if (!editor) return;

        // Ace API
        if (typeof editor.insert === 'function') {
            editor.insert(text);
            return;
        }

        // CM6 API
        if (editor.dispatch && editor.state) {
            const selection = editor.state.selection.main;
            editor.dispatch({
                changes: { from: selection.from, to: selection.to, insert: text },
                selection: { anchor: selection.from + text.length }
            });
        }
    }
}