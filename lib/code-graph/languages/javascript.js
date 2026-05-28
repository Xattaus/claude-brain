export const javascriptConfig = {
  name: 'javascript',
  wasmFile: 'tree-sitter-javascript.wasm',
  extensions: ['.js', '.mjs', '.cjs', '.jsx'],
  nodeTypes: {
    class: ['class_declaration'],
    function: ['function_declaration', 'generator_function_declaration'],
    method: ['method_definition'],
    arrow: ['arrow_function'],
    variable: ['variable_declarator'],
    import: ['import_statement'],
    call: ['call_expression'],
    export: ['export_statement', 'export_default_declaration'],
  },
  nameField: 'name',
  bodyField: 'body',
  getClassName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getFunctionName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getImportSource(node) {
    const source = node.childForFieldName('source');
    return source ? source.text.replace(/['"]/g, '') : null;
  },
  getImportSpecifiers(node) {
    const specifiers = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'import_clause') {
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j);
          if (spec.type === 'import_specifier') {
            const nameNode = spec.childForFieldName('name');
            if (nameNode) specifiers.push(nameNode.text);
          } else if (spec.type === 'identifier') {
            specifiers.push(spec.text);
          } else if (spec.type === 'named_imports') {
            for (let k = 0; k < spec.childCount; k++) {
              const named = spec.child(k);
              if (named.type === 'import_specifier') {
                const n = named.childForFieldName('name');
                if (n) specifiers.push(n.text);
              }
            }
          }
        }
      }
    }
    return specifiers;
  },
  getCallName(node) {
    const fn = node.childForFieldName('function');
    if (!fn) return null;
    if (fn.type === 'identifier') return fn.text;
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property');
      return prop ? prop.text : fn.text;
    }
    return fn.text;
  },
  getExportedName(node) {
    const decl = node.childForFieldName('declaration');
    if (!decl) return null;
    if (decl.childForFieldName && decl.childForFieldName('name')) {
      return decl.childForFieldName('name').text;
    }
    return null;
  },
  getSuperClass(node) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'class_heritage') {
        for (let j = 0; j < child.childCount; j++) {
          const heir = child.child(j);
          if (heir.type === 'identifier') return heir.text;
        }
      }
    }
    return null;
  },
};
