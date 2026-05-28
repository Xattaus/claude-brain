export const pythonConfig = {
  name: 'python',
  wasmFile: 'tree-sitter-python.wasm',
  extensions: ['.py', '.pyw'],
  nodeTypes: {
    class: ['class_definition'],
    function: ['function_definition'],
    method: ['function_definition'],
    import: ['import_statement', 'import_from_statement'],
    call: ['call'],
    decorator: ['decorator'],
    variable: ['assignment'],
  },
  nameField: 'name',
  getClassName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getFunctionName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getImportSource(node) {
    if (node.type === 'import_from_statement') {
      const modName = node.childForFieldName('module_name');
      return modName ? modName.text : null;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'dotted_name') return child.text;
    }
    return null;
  },
  getImportSpecifiers(node) {
    const specifiers = [];
    if (node.type === 'import_from_statement') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'dotted_name' && i > 0) {
          specifiers.push(child.text);
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name');
          if (name) specifiers.push(name.text);
        }
      }
    }
    return specifiers;
  },
  getCallName(node) {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute');
      return attr ? attr.text : fn.text;
    }
    return fn.text;
  },
  getSuperClass(node) {
    const args = node.childForFieldName('superclasses');
    if (!args) return null;
    for (let i = 0; i < args.childCount; i++) {
      const child = args.child(i);
      if (child.type === 'identifier') return child.text;
    }
    return null;
  },
};
