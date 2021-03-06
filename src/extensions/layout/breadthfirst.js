import * as util from '../../util';
import * as math from '../../math';
import * as is from '../../is';

const getScratch = ele => ele.scratch('breadthfirst');
const setScratch = (ele, obj) => ele.scratch('breadthfirst', obj);

/* eslint-disable no-unused-vars */
const defaults = {
  fit: true, // whether to fit the viewport to the graph
  directed: false, // whether the tree is directed downwards (or edges can point in any direction if false)
  padding: 30, // padding on fit
  circle: false, // put depths in concentric circles if true, put depths top down if false
  grid: false, // whether to create an even grid into which the DAG is placed (circle:false only)
  spacingFactor: 1.75, // positive spacing factor, larger => more space between nodes (N.B. n/a if causes overlap)
  boundingBox: undefined, // constrain layout bounds; { x1, y1, x2, y2 } or { x1, y1, w, h }
  avoidOverlap: true, // prevents node overlap, may overflow boundingBox if not enough space
  nodeDimensionsIncludeLabels: false, // Excludes the label when calculating node bounding boxes for the layout algorithm
  roots: undefined, // the roots of the trees
  animate: false, // whether to transition the node positions
  animationDuration: 500, // duration of animation in ms if enabled
  animationEasing: undefined, // easing of animation if enabled,
  animateFilter: function ( node, i ){ return true; }, // a function that determines whether the node should be animated.  All nodes animated by default on animate enabled.  Non-animated nodes are positioned immediately when the layout starts
  ready: undefined, // callback on layoutready
  stop: undefined, // callback on layoutstop
  transform: function (node, position ){ return position; } // transform a given node position. Useful for changing flow direction in discrete layouts
};
/* eslint-enable */

function BreadthFirstLayout( options ){
  this.options = util.extend( {}, defaults, options );
}

BreadthFirstLayout.prototype.run = function(){
  let params = this.options;
  let options = params;

  let cy = params.cy;
  let eles = options.eles;
  let nodes = eles.nodes().filter( n => !n.isParent() );
  let graph = eles;

  let bb = math.makeBoundingBox( options.boundingBox ? options.boundingBox : {
    x1: 0, y1: 0, w: cy.width(), h: cy.height()
  } );

  let roots;
  if( is.elementOrCollection( options.roots ) ){
    roots = options.roots;
  } else if( is.array( options.roots ) ){
    let rootsArray = [];

    for( let i = 0; i < options.roots.length; i++ ){
      let id = options.roots[ i ];
      let ele = cy.getElementById( id );
      rootsArray.push( ele );
    }

    roots = cy.collection( rootsArray );
  } else if( is.string( options.roots ) ){
    roots = cy.$( options.roots );

  } else {
    if( options.directed ){
      roots = nodes.roots();
    } else {
      let components = eles.components();

      roots = cy.collection();
      for( let i = 0; i < components.length; i++ ){
        let comp = components[i];
        let maxDegree = comp.maxDegree( false );
        let compRoots = comp.filter( function( ele ){
          return ele.degree( false ) === maxDegree;
        } );

        roots = roots.add( compRoots );
      }

    }
  }


  let depths = [];
  let foundByBfs = {};

  let addToDepth = ( ele, d ) => {
    if( depths[d] == null ){
      depths[d] = [];
    }

    let i = depths[d].length;

    depths[d].push( ele );

    setScratch( ele, {
      index: i,
      depth: d
    } );
  };

  let changeDepth = ( ele, newDepth ) => {
    let { depth, index } = getScratch( ele );

    depths[ depth ][ index ] = null;

    addToDepth( ele, newDepth );
  };

  // find the depths of the nodes
  graph.bfs( {
    roots: roots,
    directed: options.directed,
    visit: function( node, edge, pNode, i, depth ){
      let ele = node[0];
      let id = ele.id();

      addToDepth( ele, depth );
      foundByBfs[ id ] = true;
    }
  } );

  // check for nodes not found by bfs
  let orphanNodes = [];
  for( let i = 0; i < nodes.length; i++ ){
    let ele = nodes[ i ];

    if( foundByBfs[ ele.id() ] ){
      continue;
    } else {
      orphanNodes.push( ele );
    }
  }

  // assign the nodes a depth and index

  let assignDepthsAt = function( i ){
    let eles = depths[ i ];

    for( let j = 0; j < eles.length; j++ ){
      let ele = eles[ j ];

      if( ele == null ){
        eles.splice( j, 1 );
        j--;
        continue;
      }

      setScratch(ele, {
        depth: i,
        index: j
      });
    }
  };

  let assignDepths = function(){
    for( let i = 0; i < depths.length; i++ ){
      assignDepthsAt( i );
    }
  };

  // for the directed case, make sure the edges all go down (i.e. depth i => depth i + 1)
  if( options.directed ){
    for( let i = 0; i < depths.length; i++ ){
      let eles = depths[i];

      for( let j = 0; j < eles.length; j++ ){
        let ele = eles[j];
        let eInfo = getScratch( ele );
        let incomers = ele.incomers();
        let maxDepth = -1;

        for( let k = 0; k < incomers.length; k++ ){
          let incmr = incomers[k];
          let iInfo = getScratch( incmr );

          if( incmr.isNode() ){
            maxDepth = Math.max( maxDepth, iInfo.depth );
          }
        }

        if( eInfo.depth <= maxDepth ){
          changeDepth( ele, maxDepth + 1 );
        }
      }
    }
  }

  assignDepths(); // clear holes

  // find min distance we need to leave between nodes
  let minDistance = 0;
  if( options.avoidOverlap ){
    for( let i = 0; i < nodes.length; i++ ){
      let n = nodes[ i ];
      let nbb = n.layoutDimensions( options );
      let w = nbb.w;
      let h = nbb.h;

      minDistance = Math.max( minDistance, w, h );
    }
  }

  // get the weighted percent for an element based on its connectivity to other levels
  let cachedWeightedPercent = {};
  let getWeightedPercent = function( ele ){
    if( cachedWeightedPercent[ ele.id() ] ){
      return cachedWeightedPercent[ ele.id() ];
    }

    let eleDepth = getScratch( ele ).depth;
    let neighbors = ele.neighborhood();
    let percent = 0;
    let samples = 0;

    for( let i = 0; i < neighbors.length; i++ ){
      let neighbor = neighbors[ i ];

      if( neighbor.isEdge() || neighbor.isParent() || !nodes.contains( neighbor ) ){
        continue;
      }

      let bf = getScratch( neighbor );
      let index = bf.index;
      let depth = bf.depth;

      // unassigned neighbours shouldn't affect the ordering
      if( index == null || depth == null ){
        continue;
      }

      let nDepth = depths[ depth ].length;

      if( depth < eleDepth ){ // only get influenced by elements above
        percent += index / ( nDepth - 1 );
        samples++;
      }
    }

    samples = Math.max( 1, samples );
    percent = percent / samples;

    if( samples === 0 ){ // put lone nodes at the start
      percent = 0;
    }

    cachedWeightedPercent[ ele.id() ] = percent;
    return percent;
  };


  // rearrange the indices in each depth level based on connectivity

  let sortFn = function( a, b ){
    let apct = getWeightedPercent( a );
    let bpct = getWeightedPercent( b );

    let diff = apct - bpct;

    if( diff === 0 ){
      return util.sort.ascending( a.id(), b.id() ); // make sure sort doesn't have don't-care comparisons
    } else {
      return diff;
    }
  };

  // sort each level to make connected nodes closer
  for( let i = 0; i < depths.length; i++ ){
    depths[ i ].sort( sortFn );
    assignDepthsAt( i );
  }

  // assign orphan nodes to a new top-level depth
  let orphanDepth = [];
  for( let i = 0; i < orphanNodes.length; i++ ){
    orphanDepth.push( orphanNodes[i] );
  }
  depths.unshift( orphanDepth );

  assignDepths();

  let biggestDepthSize = 0;
  for( let i = 0; i < depths.length; i++ ){
    biggestDepthSize = Math.max( depths[ i ].length, biggestDepthSize );
  }

  let center = {
    x: bb.x1 + bb.w / 2,
    y: bb.x1 + bb.h / 2
  };

  let maxDepthSize = depths.reduce( (max, eles) => Math.max(max, eles.length), 0 );

  let getPosition = function( ele ){
    let info = getScratch( ele );
    let depth = info.depth;
    let index = info.index;
    let depthSize = depths[ depth ].length;

    let distanceX = Math.max( bb.w / ( (options.grid ? maxDepthSize : depthSize) + 1 ), minDistance );
    let distanceY = Math.max( bb.h / (depths.length + 1), minDistance );
    let radiusStepSize = Math.min( bb.w / 2 / depths.length, bb.h / 2 / depths.length );
    radiusStepSize = Math.max( radiusStepSize, minDistance );

    if( !options.circle ){
      let epos = {
        x: center.x + (index + 1 - (depthSize + 1) / 2) * distanceX,
        y: (depth + 1) * distanceY
      };

      return epos;
    } else {
      let radius = radiusStepSize * depth + radiusStepSize - (depths.length > 0 && depths[0].length <= 3 ? radiusStepSize / 2 : 0);
      let theta = 2 * Math.PI / depths[ depth ].length * index;

      if( depth === 0 && depths[0].length === 1 ){
        radius = 1;
      }

      return {
        x: center.x + radius * Math.cos( theta ),
        y: center.y + radius * Math.sin( theta )
      };
    }

  };

  nodes.layoutPositions( this, options, getPosition );

  return this; // chaining
};

export default BreadthFirstLayout;
