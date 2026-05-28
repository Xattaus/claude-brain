import { javascriptConfig } from './javascript.js';

export const typescriptConfig = {
  ...javascriptConfig,
  name: 'typescript',
  wasmFile: 'tree-sitter-typescript.wasm',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  nodeTypes: {
    ...javascriptConfig.nodeTypes,
    interface: ['interface_declaration'],
    typeAlias: ['type_alias_declaration'],
    enum: ['enum_declaration'],
  },
  getInterfaceName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
  getEnumName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  },
};
