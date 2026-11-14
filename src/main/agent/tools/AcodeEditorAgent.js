// src/main/core/agent/AcodeEditorAgent.js

const TAG = '[AcodeEditorAgent]';

export class AcodeEditorAgent {

    static getToolsSchema() {
        return [
            {
                name: "get_active_file_content",
                description: "Get the full text content of the file currently open and active in the editor. Use this immediately whenever the user asks to 'look at the current file', 'read the open file', or asks a question about the code they are currently looking at.",
                parameters: {
                    type: "OBJECT",
                    properties: {}
                }
            },
            {
                name: "get_open_tabs",
                description: "Get a list of all files currently opened in the editor tabs, including their names, URIs, and unsaved status.",
                parameters: {
                    type: "OBJECT",
                    properties: {}
                }
            },
            {
                name: "update_active_file_content",
                description: "Replace the entire text content of the currently active file in the editor with new code.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        newContent: { 
                            type: "STRING", 
                            description: "The new complete text content to set in the editor." 
                        }
                    },
                    required: ["newContent"]
                }
            }
        ];
    }

    static async executeTool(functionCall) {
        const { name, args = {} } = functionCall || {};
        console.log(TAG, 'executeTool ->', name, args);
        
        try {
            let result;
            switch (name) {
                case 'get_active_file_content':
                    result = this.getActiveFileContent(); 
                    break;
                case 'get_open_tabs':
                    result = this.getOpenTabs(); 
                    break;
                case 'update_active_file_content':
                    result = this.updateActiveFileContent(args.newContent); 
                    break;
                default:
                    result = { error: `Unknown tool: ${name}` };
            }
            console.log(TAG, 'executeTool <-', name, result.success ? 'Success' : 'Failed');
            return result;
        } catch (e) {
            console.error(TAG, 'executeTool threw for', name, '- raw error:', e);
            return { error: e.message || String(e) };
        }
    }

    static getActiveFileContent() {
        const editorManager = window.editorManager;
        if (!editorManager || !editorManager.editor) {
            return { error: "No active editor found." };
        }

        const activeFile = editorManager.activeFile;
        if (!activeFile) {
            return { error: "No file is currently open." };
        }

        let text = "";
        const editor = editorManager.editor;
        
        // 🟢 Handle both CM6 and Ace Editor
        if (typeof editor.dispatch === 'function' && editor.state) {
            text = editor.state.doc.toString();
        } else if (typeof editor.getValue === 'function') {
            text = editor.getValue();
        } else {
            return { error: "Could not determine editor text API." };
        }

        return {
            success: true,
            filename: activeFile.name,
            uri: activeFile.uri,
            isUnsaved: activeFile.isUnsaved,
            content: text
        };
    }

    static getOpenTabs() {
        const editorManager = window.editorManager;
        if (!editorManager || !editorManager.files) {
            return { error: "Could not access editor tabs." };
        }

        const files = editorManager.files.map(f => ({
            id: f.id,
            name: f.name,
            uri: f.uri,
            type: f.type,
            isUnsaved: f.isUnsaved,
            readOnly: f.readOnly
        }));

        return {
            success: true,
            activeFileId: editorManager.activeFile?.id,
            totalUnsaved: editorManager.hasUnsavedFiles(),
            files: files
        };
    }

    static updateActiveFileContent(newContent) {
        if (typeof newContent !== 'string') {
            return { error: "newContent must be a string." };
        }

        const editorManager = window.editorManager;
        if (!editorManager || !editorManager.editor) {
            return { error: "No active editor found." };
        }

        const editor = editorManager.editor;
        
        try {
            // 🟢 Handle both CM6 and Ace Editor
            if (typeof editor.dispatch === 'function' && editor.state) {
                editor.dispatch({
                    changes: { from: 0, to: editor.state.doc.length, insert: newContent }
                });
            } else if (typeof editor.setValue === 'function') {
                editor.setValue(newContent, -1);
            } else {
                return { error: "Could not determine editor write API." };
            }
            return { success: true, message: "File updated successfully in the editor UI." };
        } catch (e) {
            return { error: "Failed to update text: " + e.message };
        }
    }
}