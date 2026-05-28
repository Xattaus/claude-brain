export const rustConfig = {
  name: 'rust',
  wasmFile: 'tree-sitter-rust.wasm',
  extensions: ['.rs'],
  nodeTypes: {
    class: ['struct_item', 'enum_item'],
    function: ['function_item'],
    method: ['function_item'], // inside impl block
    import: ['use_declaration'],
    call: ['call_expression', 'macro_invocation'],
    trait: ['trait_item'],
    impl: ['impl_item'],
  },
  getClassName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getFunctionName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getImportSource(node) {
    // use std::collections::HashMap;
    // use crate::module::Item;
    // The argument field contains the path
    const arg = node.childForFieldName('argument');
    if (arg) {
      // Get the full path text, e.g. "std::collections::HashMap"
      return arg.text;
    }
    // Fallback: get first scoped_identifier or identifier child
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (
        child.type === 'scoped_identifier' ||
        child.type === 'identifier' ||
        child.type === 'use_wildcard' ||
        child.type === 'scoped_use_list' ||
        child.type === 'use_list'
      ) {
        return child.text;
      }
    }
    return null;
  },
  getImportSpecifiers(node) {
    // For `use foo::bar::{Baz, Qux};` extract Baz, Qux
    const specifiers = [];
    function findIdentifiers(n) {
      if (
        n.type === 'identifier' &&
        n.parent &&
        (n.parent.type === 'use_list' || n.parent.type === 'scoped_use_list')
      ) {
        specifiers.push(n.text);
      }
      for (let i = 0; i < n.childCount; i++) {
        findIdentifiers(n.child(i));
      }
    }
    findIdentifiers(node);
    return specifiers;
  },
  getCallName(node) {
    const fn = node.childForFieldName('function');
    if (fn) {
      if (fn.type === 'identifier') return fn.text;
      if (fn.type === 'scoped_identifier' || fn.type === 'field_expression') {
        // Get the last identifier in the chain
        const field = fn.childForFieldName('name') || fn.childForFieldName('field');
        return field ? field.text : fn.text;
      }
      return fn.text;
    }
    // macro_invocation: the macro name is the first child
    if (node.type === 'macro_invocation') {
      const macro = node.child(0);
      return macro ? macro.text.replace('!', '') : null;
    }
    return null;
  },
  getSuperClass(node) {
    // For structs/enums, there's no direct inheritance in Rust
    // But we can check for trait bounds in impl blocks
    return null;
  },
};
