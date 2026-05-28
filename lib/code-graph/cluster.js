import louvain from 'graphology-communities-louvain';

export function detectCommunities(graph, options = {}) {
  const resolution = options.resolution || 1.0;
  const maxCommunitySize = options.maxCommunitySize || 50;

  const communities = louvain.detailed(graph, { resolution });

  // Assign community attribute to each node
  for (const [nodeId, communityId] of Object.entries(communities.communities)) {
    if (graph.hasNode(nodeId)) {
      graph.setNodeAttribute(nodeId, 'community', communityId);
    }
  }

  // Check for oversized communities and re-split by file
  const communitySizes = new Map();
  for (const [nodeId, communityId] of Object.entries(communities.communities)) {
    if (!communitySizes.has(communityId)) communitySizes.set(communityId, []);
    communitySizes.get(communityId).push(nodeId);
  }

  let nextCommunityId = communities.count;
  for (const [communityId, members] of communitySizes) {
    if (members.length > maxCommunitySize) {
      const fileGroups = new Map();
      for (const nodeId of members) {
        const file = graph.getNodeAttribute(nodeId, 'file') || 'unknown';
        if (!fileGroups.has(file)) fileGroups.set(file, []);
        fileGroups.get(file).push(nodeId);
      }
      if (fileGroups.size > 1) {
        let groupIdx = 0;
        for (const [file, nodes] of fileGroups) {
          const subId = nextCommunityId + groupIdx;
          for (const nodeId of nodes) {
            graph.setNodeAttribute(nodeId, 'community', subId);
          }
          groupIdx++;
        }
        nextCommunityId += groupIdx;
      }
    }
  }

  const finalCommunities = new Set();
  graph.forEachNode((id) => {
    finalCommunities.add(graph.getNodeAttribute(id, 'community'));
  });

  return { count: finalCommunities.size, modularity: communities.modularity };
}

export function getCommunityStats(graph) {
  const communityMap = new Map();

  graph.forEachNode((id, attrs) => {
    const community = attrs.community;
    if (community === undefined) return;
    if (!communityMap.has(community)) {
      communityMap.set(community, { id: community, nodes: [], files: new Set(), types: new Map() });
    }
    const c = communityMap.get(community);
    c.nodes.push(id);
    if (attrs.file) c.files.add(attrs.file);
    const type = attrs.type || 'unknown';
    c.types.set(type, (c.types.get(type) || 0) + 1);
  });

  const communities = [];
  for (const [id, data] of communityMap) {
    communities.push({
      id,
      size: data.nodes.length,
      nodes: data.nodes,
      files: [...data.files],
      types: Object.fromEntries(data.types),
    });
  }
  communities.sort((a, b) => b.size - a.size);

  return { communities, totalCommunities: communities.length };
}
