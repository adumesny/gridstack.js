/*!
 * GridStack 12.2.2-dev
 * https://gridstackjs.com/
 *
 * Copyright (c) 2021-2024  Alain Dumesny
 * see root license https://github.com/gridstack/gridstack.js/tree/master/LICENSE
 */
import { GridStackEngine } from './gridstack-engine';
import { Utils, HeightData, obsolete, DragTransform } from './utils';
import {
  gridDefaults, ColumnOptions, GridItemHTMLElement, GridStackElement, GridStackEventHandlerCallback,
  GridStackNode, GridStackWidget, numberOrString, DDUIData, DDDragOpt, GridStackPosition, GridStackOptions,
  GridStackEventHandler, GridStackNodesHandler, AddRemoveFcn, SaveFcn, CompactOptions, GridStackMoveOpts, ResizeToContentFcn, GridStackDroppedHandler, GridStackElementHandler,
  Position, RenderFcn
} from './types';

/*
 * and include D&D by default
 * TODO: while we could generate a gridstack-static.js at smaller size - saves about 31k (41k -> 72k)
 * I don't know how to generate the DD only code at the remaining 31k to delay load as code depends on Gridstack.ts
 * also it caused loading issues in prod - see https://github.com/gridstack/gridstack.js/issues/2039
 */
import { DDGridStack } from './dd-gridstack';
import { isTouch } from './dd-touch';
import { DDManager } from './dd-manager';
import { DDElementHost } from './dd-element'; /** global instance */
const dd = new DDGridStack;

// export all dependent file as well to make it easier for users to just import the main file
export * from './types';
export * from './utils';
export * from './gridstack-engine';
export * from './dd-gridstack';

export interface GridHTMLElement extends HTMLElement {
  gridstack?: GridStack; // grid's parent DOM element points back to grid class
}
/** list of possible events, or space separated list of them */
export type GridStackEvent = 'added' | 'change' | 'disable' | 'drag' | 'dragstart' | 'dragstop' | 'dropped' |
  'enable' | 'removed' | 'resize' | 'resizestart' | 'resizestop' | 'resizecontent';

/** Defines the coordinates of an object */
export interface MousePosition {
  top: number;
  left: number;
}

/** Defines the position of a cell inside the grid*/
export interface CellPosition {
  x: number;
  y: number;
}

// extend with internal fields we need - TODO: move other items in here
interface InternalGridStackOptions extends GridStackOptions {
  _alwaysShowResizeHandle?: true | false | 'mobile'; // so we can restore for save
}

/**
 * Main gridstack class - you will need to call `GridStack.init()` first to initialize your grid.
 * Note: your grid elements MUST have the following classes for the CSS layout to work:
 * @example
 * <div class="grid-stack">
 *   <div class="grid-stack-item">
 *     <div class="grid-stack-item-content">Item 1</div>
 *   </div>
 * </div>
 */
export class GridStack {

  /**
   * initializing the HTML element, or selector string, into a grid will return the grid. Calling it again will
   * simply return the existing instance (ignore any passed options). There is also an initAll() version that support
   * multiple grids initialization at once. Or you can use addGrid() to create the entire grid from JSON.
   * @param options grid options (optional)
   * @param elOrString element or CSS selector (first one used) to convert to a grid (default to '.grid-stack' class selector)
   *
   * @example
   * const grid = GridStack.init();
   *
   * Note: the HTMLElement (of type GridHTMLElement) will store a `gridstack: GridStack` value that can be retrieve later
   * const grid = document.querySelector('.grid-stack').gridstack;
   */
  public static init(options: GridStackOptions = {}, elOrString: GridStackElement = '.grid-stack'): GridStack {
    if (typeof document === 'undefined') return null; // temp workaround SSR
    const el = GridStack.getGridElement(elOrString);
    if (!el) {
      if (typeof elOrString === 'string') {
        console.error('GridStack.initAll() no grid was found with selector "' + elOrString + '" - element missing or wrong selector ?' +
          '\nNote: ".grid-stack" is required for proper CSS styling and drag/drop, and is the default selector.');
      } else {
        console.error('GridStack.init() no grid element was passed.');
      }
      return null;
    }
    if (!el.gridstack) {
      el.gridstack = new GridStack(el, Utils.cloneDeep(options));
    }
    return el.gridstack
  }

  /**
   * Will initialize a list of elements (given a selector) and return an array of grids.
   * @param options grid options (optional)
   * @param selector elements selector to convert to grids (default to '.grid-stack' class selector)
   *
   * @example
   * const grids = GridStack.initAll();
   * grids.forEach(...)
   */
  public static initAll(options: GridStackOptions = {}, selector = '.grid-stack'): GridStack[] {
    const grids: GridStack[] = [];
    if (typeof document === 'undefined') return grids; // temp workaround SSR
    GridStack.getGridElements(selector).forEach(el => {
      if (!el.gridstack) {
        el.gridstack = new GridStack(el, Utils.cloneDeep(options));
      }
      grids.push(el.gridstack);
    });
    if (grids.length === 0) {
      console.error('GridStack.initAll() no grid was found with selector "' + selector + '" - element missing or wrong selector ?' +
        '\nNote: ".grid-stack" is required for proper CSS styling and drag/drop, and is the default selector.');
    }
    return grids;
  }

  /**
   * call to create a grid with the given options, including loading any children from JSON structure. This will call GridStack.init(), then
   * grid.load() on any passed children (recursively). Great alternative to calling init() if you want entire grid to come from
   * JSON serialized data, including options.
   * @param parent HTML element parent to the grid
   * @param opt grids options used to initialize the grid, and list of children
   */
  public static addGrid(parent: HTMLElement, opt: GridStackOptions = {}): GridStack {
    if (!parent) return null;

    let el = parent as GridHTMLElement;
    if (el.gridstack) {
      // already a grid - set option and load data
      const grid = el.gridstack;
      if (opt) grid.opts = { ...grid.opts, ...opt };
      if (opt.children !== undefined) grid.load(opt.children);
      return grid;
    }

    // create the grid element, but check if the passed 'parent' already has grid styling and should be used instead
    const parentIsGrid = parent.classList.contains('grid-stack');
    if (!parentIsGrid || GridStack.addRemoveCB) {
      if (GridStack.addRemoveCB) {
        el = GridStack.addRemoveCB(parent, opt, true, true);
      } else {
        el = Utils.createDiv(['grid-stack', opt.class], parent);
      }
    }

    // create grid class and load any children
    const grid = GridStack.init(opt, el);
    return grid;
  }

  /** call this method to register your engine instead of the default one.
   * See instead `GridStackOptions.engineClass` if you only need to
   * replace just one instance.
   */
  static registerEngine(engineClass: typeof GridStackEngine): void {
    GridStack.engineClass = engineClass;
  }

  /**
   * callback method use when new items|grids needs to be created or deleted, instead of the default
   * item: <div class="grid-stack-item"><div class="grid-stack-item-content">w.content</div></div>
   * grid: <div class="grid-stack">grid content...</div>
   * add = true: the returned DOM element will then be converted to a GridItemHTMLElement using makeWidget()|GridStack:init().
   * add = false: the item will be removed from DOM (if not already done)
   * grid = true|false for grid vs grid-items
   */
  public static addRemoveCB?: AddRemoveFcn;

  /**
   * callback during saving to application can inject extra data for each widget, on top of the grid layout properties
   */
  public static saveCB?: SaveFcn;

  /**
   * callback to create the content of widgets so the app can control how to store and restore it
   * By default this lib will do 'el.textContent = w.content' forcing text only support for avoiding potential XSS issues.
   */
  public static renderCB?: RenderFcn = (el: HTMLElement, w: GridStackNode) => { if (el && w?.content) el.textContent = w.content; };

  /** called after a widget has been updated (eg: load() into an existing list of children) so application can do extra work */
  public static updateCB?: (w: GridStackNode) => void;

  /** callback to use for resizeToContent instead of the built in one */
  public static resizeToContentCB?: ResizeToContentFcn;
  /** parent class for sizing content. defaults to '.grid-stack-item-content' */
  public static resizeToContentParent = '.grid-stack-item-content';

  /** scoping so users can call GridStack.Utils.sort() for example */
  public static Utils = Utils;

  /** scoping so users can call new GridStack.Engine(12) for example */
  public static Engine = GridStackEngine;

  /** engine used to implement non DOM grid functionality */
  public engine: GridStackEngine;

  /** point to a parent grid item if we're nested (inside a grid-item in between 2 Grids) */
  public parentGridNode?: GridStackNode;

  /** time to wait for animation (if enabled) to be done so content sizing can happen */
  public animationDelay = 300 + 10;

  protected static engineClass: typeof GridStackEngine;
  protected resizeObserver: ResizeObserver;

  /** @internal true if we got created by drag over gesture, so we can removed on drag out (temporary) */
  public _isTemp?: boolean;

  /** @internal create placeholder DIV as needed */
  public get placeholder(): GridItemHTMLElement {
    if (!this._placeholder) {
      this._placeholder = Utils.createDiv([this.opts.placeholderClass, gridDefaults.itemClass, this.opts.itemClass]);
      const placeholderChild = Utils.createDiv(['placeholder-content'], this._placeholder);
      if (this.opts.placeholderText) {
        placeholderChild.textContent = this.opts.placeholderText;
      }
    }
    return this._placeholder;
  }
  /** @internal */
  protected _placeholder: GridItemHTMLElement;
  /** @internal prevent cached layouts from being updated when loading into small column layouts */
  protected _ignoreLayoutsNodeChange: boolean;
  /** @internal */
  public _gsEventHandler = {};
  /** @internal flag to keep cells square during resize */
  protected _isAutoCellHeight: boolean;
  /** @internal limit auto cell resizing method */
  protected _sizeThrottle: () => void;
  /** @internal limit auto cell resizing method */
  protected prevWidth: number;
  /** @internal extra row added when dragging at the bottom of the grid */
  protected _extraDragRow = 0;
  /** @internal true if nested grid should get column count from our width */
  protected _autoColumn?: boolean;
  /** @internal meant to store the scale of the active grid */
  protected dragTransform: DragTransform = { xScale: 1, yScale: 1, xOffset: 0, yOffset: 0 };
  protected responseLayout: ColumnOptions;
  private _skipInitialResize: boolean;

  /**
   * Construct a grid item from the given element and options
   * @param el the HTML element tied to this grid after it's been initialized
   * @param opts grid options - public for classes to access, but use methods to modify!
   */
  public constructor(public el: GridHTMLElement, public opts: GridStackOptions = {}) {
    el.gridstack = this;
    this.opts = opts = opts || {}; // handles null/undefined/0

    if (!el.classList.contains('grid-stack')) {
      this.el.classList.add('grid-stack');
    }

    // if row property exists, replace minRow and maxRow instead
    if (opts.row) {
      opts.minRow = opts.maxRow = opts.row;
      delete opts.row;
    }
    const rowAttr = Utils.toNumber(el.getAttribute('gs-row'));

    // flag only valid in sub-grids (handled by parent, not here)
    if (opts.column === 'auto') {
      delete opts.column;
    }
    // save original setting so we can restore on save
    if (opts.alwaysShowResizeHandle !== undefined) {
      (opts as InternalGridStackOptions)._alwaysShowResizeHandle = opts.alwaysShowResizeHandle;
    }

    // cleanup responsive opts (must have columnWidth | breakpoints) then sort breakpoints by size (so we can match during resize)
    const resp = opts.columnOpts;
    if (resp) {
      const bk = resp.breakpoints;
      if (!resp.columnWidth && !bk?.length) {
        delete opts.columnOpts;
      } else {
        resp.columnMax = resp.columnMax || 12;
        if (bk?.length > 1) bk.sort((a, b) => (b.w || 0) - (a.w || 0));
      }
    }

    // elements DOM attributes override any passed options (like CSS style) - merge the two together
    const defaults: GridStackOptions = {
      ...Utils.cloneDeep(gridDefaults),
      column: Utils.toNumber(el.getAttribute('gs-column')) || gridDefaults.column,
      minRow: rowAttr ? rowAttr : Utils.toNumber(el.getAttribute('gs-min-row')) || gridDefaults.minRow,
      maxRow: rowAttr ? rowAttr : Utils.toNumber(el.getAttribute('gs-max-row')) || gridDefaults.maxRow,
      staticGrid: Utils.toBool(el.getAttribute('gs-static')) || gridDefaults.staticGrid,
      sizeToContent: Utils.toBool(el.getAttribute('gs-size-to-content')) || undefined,
      draggable: {
        handle: (opts.handleClass ? '.' + opts.handleClass : (opts.handle ? opts.handle : '')) || gridDefaults.draggable.handle,
      },
      removableOptions: {
        accept: opts.itemClass || gridDefaults.removableOptions.accept,
        decline: gridDefaults.removableOptions.decline
      },
    };
    if (el.getAttribute('gs-animate')) { // default to true, but if set to false use that instead
      defaults.animate = Utils.toBool(el.getAttribute('gs-animate'))
    }

    opts = Utils.defaults(opts, defaults);
    this._initMargin(); // part of settings defaults...

    // Now check if we're loading into !12 column mode FIRST so we don't do un-necessary work (like cellHeight = width / 12 then go 1 column)
    this.checkDynamicColumn();
    this._updateColumnVar(opts);

    if (opts.rtl === 'auto') {
      opts.rtl = (el.style.direction === 'rtl');
    }
    if (opts.rtl) {
      this.el.classList.add('grid-stack-rtl');
    }

    // check if we're been nested, and if so update our style and keep pointer around (used during save)
    const parentGridItem: GridItemHTMLElement = this.el.closest('.' + gridDefaults.itemClass);
    const parentNode = parentGridItem?.gridstackNode;
    if (parentNode) {
      parentNode.subGrid = this;
      this.parentGridNode = parentNode;
      this.el.classList.add('grid-stack-nested');
      parentNode.el.classList.add('grid-stack-sub-grid');
    }

    this._isAutoCellHeight = (opts.cellHeight === 'auto');
    if (this._isAutoCellHeight || opts.cellHeight === 'initial') {
      // make the cell content square initially (will use resize/column event to keep it square)
      this.cellHeight(undefined);
    } else {
      // append unit if any are set
      if (typeof opts.cellHeight == 'number' && opts.cellHeightUnit && opts.cellHeightUnit !== gridDefaults.cellHeightUnit) {
        opts.cellHeight = opts.cellHeight + opts.cellHeightUnit;
        delete opts.cellHeightUnit;
      }
      const val = opts.cellHeight;
      delete opts.cellHeight; // force initial cellHeight() call to set the value
      this.cellHeight(val);
    }

    // see if we need to adjust auto-hide
    if (opts.alwaysShowResizeHandle === 'mobile') {
      opts.alwaysShowResizeHandle = isTouch;
    }

    this._setStaticClass();

    const engineClass = opts.engineClass || GridStack.engineClass || GridStackEngine;
    this.engine = new engineClass({
      column: this.getColumn(),
      float: opts.float,
      maxRow: opts.maxRow,
      onChange: (cbNodes) => {
        cbNodes.forEach(n => {
          const el = n.el;
          if (!el) return;
          if (n._removeDOM) {
            if (el) el.remove();
            delete n._removeDOM;
          } else {
            this._writePosAttr(el, n);
          }
        });
        this._updateContainerHeight();
      }
    });

    if (opts.auto) {
      this.batchUpdate(); // prevent in between re-layout #1535 TODO: this only set float=true, need to prevent collision check...
      this.engine._loading = true; // loading collision check
      this.getGridItems().forEach(el => this._prepareElement(el));
      delete this.engine._loading;
      this.batchUpdate(false);
    }

    // load any passed in children as well, which overrides any DOM layout done above
    if (opts.children) {
      const children = opts.children;
      delete opts.children;
      if (children.length) this.load(children); // don't load empty
    }

    this.setAnimation();

    // dynamic grids require pausing during drag to detect over to nest vs push
    if (opts.subGridDynamic && !DDManager.pauseDrag) DDManager.pauseDrag = true;
    if (opts.draggable?.pause !== undefined) DDManager.pauseDrag = opts.draggable.pause;

    this._setupRemoveDrop();
    this._setupAcceptWidget();
    this._updateResizeEvent();
  }

  private _updateColumnVar(opts: GridStackOptions = this.opts): void {
    this.el.classList.add('gs-' + opts.column);
    if (typeof opts.column === 'number') this.el.style.setProperty('--gs-column-width', `${100/opts.column}%`);
  }

  /**
   * add a new widget and returns it.
   *
   * Widget will be always placed even if result height is more than actual grid height.
   * You need to use `willItFit()` before calling addWidget for additional check.
   * See also `makeWidget(el)` for DOM element.
   *
   * @example
   * const grid = GridStack.init();
   * grid.addWidget({w: 3, content: 'hello'});
   *
   * @param w GridStackWidget definition. used MakeWidget(el) if you have dom element instead.
   */
  public addWidget(w: GridStackWidget): GridItemHTMLElement {
    if (!w) return;
    if (typeof w === 'string') { console.error('V11: GridStack.addWidget() does not support string anymore. see #2736'); return; }
    if ((w as HTMLElement).ELEMENT_NODE) { console.error('V11: GridStack.addWidget() does not support HTMLElement anymore. use makeWidget()'); return this.makeWidget(w as HTMLElement); }

    let el: GridItemHTMLElement;
    let node: GridStackNode = w;
    node.grid = this;
    if (node.el) {
      el = node.el; // re-use element stored in the node
    } else if (GridStack.addRemoveCB) {
      el = GridStack.addRemoveCB(this.el, w, true, false);
    } else {
      el = this.createWidgetDivs(node);
    }

    if (!el) return;

    // if the caller ended up initializing the widget in addRemoveCB, or we stared with one already, skip the rest
    node = el.gridstackNode;
    if (node && el.parentElement === this.el && this.engine.nodes.find(n => n._id === node._id)) return el;

    // Tempting to initialize the passed in opt with default and valid values, but this break knockout demos
    // as the actual value are filled in when _prepareElement() calls el.getAttribute('gs-xyz') before adding the node.
    // So make sure we load any DOM attributes that are not specified in passed in options (which override)
    const domAttr = this._readAttr(el);
    Utils.defaults(w, domAttr);
    this.engine.prepareNode(w);
    // this._writeAttr(el, w); why write possibly incorrect values back when makeWidget() will ?

    this.el.appendChild(el);

    this.makeWidget(el, w);

    return el;
  }

  /** create the default grid item divs, and content (possibly lazy loaded) by using GridStack.renderCB() */
  public createWidgetDivs(n: GridStackNode): HTMLElement {
    const el = Utils.createDiv(['grid-stack-item', this.opts.itemClass]);
    const cont = Utils.createDiv(['grid-stack-item-content'], el);

    if (Utils.lazyLoad(n)) {
      if (!n.visibleObservable) {
        n.visibleObservable = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) {
          n.visibleObservable?.disconnect();
          delete n.visibleObservable;
          GridStack.renderCB(cont, n);
          n.grid?.prepareDragDrop(n.el);
        }});
        window.setTimeout(() => n.visibleObservable?.observe(el)); // wait until callee sets position attributes
      }
    } else GridStack.renderCB(cont, n);

    return el;
  }

  /**
   * Convert an existing gridItem element into a sub-grid with the given (optional) options, else inherit them
   * from the parent's subGrid options.
   * @param el gridItem element to convert
   * @param ops (optional) sub-grid options, else default to node, then parent settings, else defaults
   * @param nodeToAdd (optional) node to add to the newly created sub grid (used when dragging over existing regular item)
   * @param saveContent if true (default) the html inside .grid-stack-content will be saved to child widget
   * @returns newly created grid
   */
  public makeSubGrid(el: GridItemHTMLElement, ops?: GridStackOptions, nodeToAdd?: GridStackNode, saveContent = true): GridStack {
    let node = el.gridstackNode;
    if (!node) {
      node = this.makeWidget(el).gridstackNode;
    }
    if (node.subGrid?.el) return node.subGrid; // already done

    // find the template subGrid stored on a parent as fallback...
    let subGridTemplate: GridStackOptions; // eslint-disable-next-line @typescript-eslint/no-this-alias
    let grid: GridStack = this;
    while (grid && !subGridTemplate) {
      subGridTemplate = grid.opts?.subGridOpts;
      grid = grid.parentGridNode?.grid;
    }
    //... and set the create options
    ops = Utils.cloneDeep({
      // by default sub-grid inherit from us | parent, other than id, children, etc...
      ...this.opts, id: undefined, children: undefined, column: 'auto', columnOpts: undefined, layout: 'list', subGridOpts: undefined,
      ...(subGridTemplate || {}),
      ...(ops || node.subGridOpts || {})
    });
    node.subGridOpts = ops;

    // if column special case it set, remember that flag and set default
    let autoColumn: boolean;
    if (ops.column === 'auto') {
      autoColumn = true;
      ops.column = Math.max(node.w || 1, nodeToAdd?.w || 1);
      delete ops.columnOpts; // driven by parent
    }

    // if we're converting an existing full item, move over the content to be the first sub item in the new grid
    let content = node.el.querySelector('.grid-stack-item-content') as HTMLElement;
    let newItem: HTMLElement;
    let newItemOpt: GridStackNode;
    if (saveContent) {
      this._removeDD(node.el); // remove D&D since it's set on content div
      newItemOpt = { ...node, x: 0, y: 0 };
      Utils.removeInternalForSave(newItemOpt);
      delete newItemOpt.subGridOpts;
      if (node.content) {
        newItemOpt.content = node.content;
        delete node.content;
      }
      if (GridStack.addRemoveCB) {
        newItem = GridStack.addRemoveCB(this.el, newItemOpt, true, false);
      } else {
        newItem = Utils.createDiv(['grid-stack-item']);
        newItem.appendChild(content);
        content = Utils.createDiv(['grid-stack-item-content'], node.el);
      }
      this.prepareDragDrop(node.el); // ... and restore original D&D
    }

    // if we're adding an additional item, make the container large enough to have them both
    if (nodeToAdd) {
      const w = autoColumn ? ops.column : node.w;
      const h = node.h + nodeToAdd.h;
      const style = node.el.style;
      style.transition = 'none'; // show up instantly so we don't see scrollbar with nodeToAdd
      this.update(node.el, { w, h });
      setTimeout(() => style.transition = null); // recover animation
    }

    const subGrid = node.subGrid = GridStack.addGrid(content, ops);
    if (nodeToAdd?._moving) subGrid._isTemp = true; // prevent re-nesting as we add over
    if (autoColumn) subGrid._autoColumn = true;

    // add the original content back as a child of hte newly created grid
    if (saveContent) {
      subGrid.makeWidget(newItem, newItemOpt);
    }

    // now add any additional node
    if (nodeToAdd) {
      if (nodeToAdd._moving) {
        // create an artificial event even for the just created grid to receive this item
        window.setTimeout(() => Utils.simulateMouseEvent(nodeToAdd._event, 'mouseenter', subGrid.el), 0);
      } else {
        subGrid.makeWidget(node.el, node);
      }
    }

    // if sizedToContent, we need to re-calc the size of ourself
    this.resizeToContentCheck(false, node);

    return subGrid;
  }

  /**
   * called when an item was converted into a nested grid to accommodate a dragged over item, but then item leaves - return back
   * to the original grid-item. Also called to remove empty sub-grids when last item is dragged out (since re-creating is simple)
   */
  public removeAsSubGrid(nodeThatRemoved?: GridStackNode): void {
    const pGrid = this.parentGridNode?.grid;
    if (!pGrid) return;

    pGrid.batchUpdate();
    pGrid.removeWidget(this.parentGridNode.el, true, true);
    this.engine.nodes.forEach(n => {
      // migrate any children over and offsetting by our location
      n.x += this.parentGridNode.x;
      n.y += this.parentGridNode.y;
      pGrid.makeWidget(n.el, n);
    });
    pGrid.batchUpdate(false);
    if (this.parentGridNode) delete this.parentGridNode.subGrid;
    delete this.parentGridNode;

    // create an artificial event for the original grid now that this one is gone (got a leave, but won't get enter)
    if (nodeThatRemoved) {
      window.setTimeout(() => Utils.simulateMouseEvent(nodeThatRemoved._event, 'mouseenter', pGrid.el), 0);
    }
  }

  /**
   * saves the current layout returning a list of widgets for serialization which might include any nested grids.
   * @param saveContent if true (default) the latest html inside .grid-stack-content will be saved to GridStackWidget.content field, else it will
   * be removed.
   * @param saveGridOpt if true (default false), save the grid options itself, so you can call the new GridStack.addGrid()
   * to recreate everything from scratch. GridStackOptions.children would then contain the widget list instead.
   * @param saveCB callback for each node -> widget, so application can insert additional data to be saved into the widget data structure.
   * @returns list of widgets or full grid option, including .children list of widgets
   */
  public save(saveContent = true, saveGridOpt = false, saveCB = GridStack.saveCB): GridStackWidget[] | GridStackOptions {
    // return copied GridStackWidget (with optionally .el) we can modify at will...
    const list = this.engine.save(saveContent, saveCB);

    // check for HTML content and nested grids
    list.forEach(n => {
      if (saveContent && n.el && !n.subGrid && !saveCB) { // sub-grid are saved differently, not plain content
        const itemContent = n.el.querySelector('.grid-stack-item-content');
        n.content = itemContent?.innerHTML;
        if (!n.content) delete n.content;
      } else {
        if (!saveContent && !saveCB) { delete n.content; }
        // check for nested grid
        if (n.subGrid?.el) {
          const listOrOpt = n.subGrid.save(saveContent, saveGridOpt, saveCB);
          n.subGridOpts = (saveGridOpt ? listOrOpt : { children: listOrOpt }) as GridStackOptions;
          delete n.subGrid;
        }
      }
      delete n.el;
    });

    // check if save entire grid options (needed for recursive) + children...
    if (saveGridOpt) {
      const o: InternalGridStackOptions = Utils.cloneDeep(this.opts);
      // delete default values that will be recreated on launch
      if (o.marginBottom === o.marginTop && o.marginRight === o.marginLeft && o.marginTop === o.marginRight) {
        o.margin = o.marginTop;
        delete o.marginTop; delete o.marginRight; delete o.marginBottom; delete o.marginLeft;
      }
      if (o.rtl === (this.el.style.direction === 'rtl')) { o.rtl = 'auto' }
      if (this._isAutoCellHeight) {
        o.cellHeight = 'auto'
      }
      if (this._autoColumn) {
        o.column = 'auto';
      }
      const origShow = o._alwaysShowResizeHandle;
      delete o._alwaysShowResizeHandle;
      if (origShow !== undefined) {
        o.alwaysShowResizeHandle = origShow;
      } else {
        delete o.alwaysShowResizeHandle;
      }
      Utils.removeInternalAndSame(o, gridDefaults);
      o.children = list;
      return o;
    }

    return list;
  }

  /**
   * load the widgets from a list. This will call update() on each (matching by id) or add/remove widgets that are not there.
   *
   * @param items list of widgets definition to update/create
   * @param addRemove boolean (default true) or callback method can be passed to control if and how missing widgets can be added/removed, giving
   * the user control of insertion.
   *
   * @example
   * see http://gridstackjs.com/demo/serialization.html
   */
  public load(items: GridStackWidget[], addRemove: boolean | AddRemoveFcn = GridStack.addRemoveCB || true): GridStack {
    items = Utils.cloneDeep(items); // so we can mod
    const column = this.getColumn();

    // make sure size 1x1 (default) is present as it may need to override current sizes
    items.forEach(n => { n.w = n.w || 1; n.h = n.h || 1 });

    // sort items. those without coord will be appended last
    items = Utils.sort(items);

    this.engine.skipCacheUpdate = this._ignoreLayoutsNodeChange = true; // skip layout update

    // if we're loading a layout into for example 1 column and items don't fit, make sure to save
    // the original wanted layout so we can scale back up correctly #1471
    let maxColumn = 0;
    items.forEach(n => { maxColumn = Math.max(maxColumn, (n.x || 0) + n.w) });
    if (maxColumn > this.engine.defaultColumn) this.engine.defaultColumn = maxColumn;
    if (maxColumn > column) {
      // if we're loading (from empty) into a smaller column, check for special responsive layout
      if (this.engine.nodes.length === 0 && this.responseLayout) {
        this.engine.nodes = items;
        this.engine.columnChanged(maxColumn, column, this.responseLayout);
        items = this.engine.nodes;
        this.engine.nodes = [];
        delete this.responseLayout;
      } else this.engine.cacheLayout(items, maxColumn, true);
    }

    // if given a different callback, temporally set it as global option so creating will use it
    const prevCB = GridStack.addRemoveCB;
    if (typeof (addRemove) === 'function') GridStack.addRemoveCB = addRemove as AddRemoveFcn;

    const removed: GridStackNode[] = [];
    this.batchUpdate();

    // if we are loading from empty temporarily remove animation
    const blank = !this.engine.nodes.length;
    const noAnim = blank && this.opts.animate;
    if (noAnim) this.setAnimation(false);

    // see if any items are missing from new layout and need to be removed first
    if (!blank && addRemove) {
      const copyNodes = [...this.engine.nodes]; // don't loop through array you modify
      copyNodes.forEach(n => {
        if (!n.id) return;
        const item = Utils.find(items, n.id);
        if (!item) {
          if (GridStack.addRemoveCB) GridStack.addRemoveCB(this.el, n, false, false);
          removed.push(n); // batch keep track
          this.removeWidget(n.el, true, false);
        }
      });
    }

    // now add/update the widgets - starting with removing items in the new layout we will reposition
    // to reduce collision and add no-coord ones at next available spot
    this.engine._loading = true; // help with collision
    const updateNodes: GridStackWidget[] = [];
    this.engine.nodes = this.engine.nodes.filter(n => {
      if (Utils.find(items, n.id)) { updateNodes.push(n); return false; } // remove if found from list
      return true;
    });
    items.forEach(w => {
      const item = Utils.find(updateNodes, w.id);
      if (item) {
        // if item sizes to content, re-use the exiting height so it's a better guess at the final size (same if width doesn't change)
        if (Utils.shouldSizeToContent(item)) w.h = item.h;
        // check if missing coord, in which case find next empty slot with new (or old if missing) sizes
        this.engine.nodeBoundFix(w);
        if (w.autoPosition || w.x === undefined || w.y === undefined) {
          w.w = w.w || item.w;
          w.h = w.h || item.h;
          this.engine.findEmptyPosition(w);
        }

        // add back to current list BUT force a collision check if it 'appears' we didn't change to make sure we don't overlap others now
        this.engine.nodes.push(item);
        if (Utils.samePos(item, w) && this.engine.nodes.length > 1) {
          this.moveNode(item, { ...w, forceCollide: true });
          Utils.copyPos(w, item); // use possily updated values before update() is called next (no-op since already moved)
        }

        this.update(item.el, w);

        if (w.subGridOpts?.children) { // update any sub grid as well
          const sub = item.el.querySelector('.grid-stack') as GridHTMLElement;
          if (sub && sub.gridstack) {
            sub.gridstack.load(w.subGridOpts.children); // TODO: support updating grid options ?
          }
        }
      } else if (addRemove) {
        this.addWidget(w);
      }
    });

    delete this.engine._loading; // done loading
    this.engine.removedNodes = removed;
    this.batchUpdate(false);

    // after commit, clear that flag
    delete this._ignoreLayoutsNodeChange;
    delete this.engine.skipCacheUpdate;
    prevCB ? GridStack.addRemoveCB = prevCB : delete GridStack.addRemoveCB;
    if (noAnim) this.setAnimation(true, true); // delay adding animation back
    return this;
  }

  /**
   * use before calling a bunch of `addWidget()` to prevent un-necessary relayouts in between (more efficient)
   * and get a single event callback. You will see no changes until `batchUpdate(false)` is called.
   */
  public batchUpdate(flag = true): GridStack {
    this.engine.batchUpdate(flag);
    if (!flag) {
      this._updateContainerHeight();
      this._triggerRemoveEvent();
      this._triggerAddEvent();
      this._triggerChangeEvent();
    }
    return this;
  }

  /**
   * Gets current cell height.
   */
  public getCellHeight(forcePixel = false): number {
    if (this.opts.cellHeight && this.opts.cellHeight !== 'auto' &&
      (!forcePixel || !this.opts.cellHeightUnit || this.opts.cellHeightUnit === 'px')) {
      return this.opts.cellHeight as number;
    }
    // do rem/em/cm/mm to px conversion
    if (this.opts.cellHeightUnit === 'rem') {
      return (this.opts.cellHeight as number) * parseFloat(getComputedStyle(document.documentElement).fontSize);
    }
    if (this.opts.cellHeightUnit === 'em') {
      return (this.opts.cellHeight as number) * parseFloat(getComputedStyle(this.el).fontSize);
    }
    if (this.opts.cellHeightUnit === 'cm') {
      // 1cm = 96px/2.54. See https://www.w3.org/TR/css-values-3/#absolute-lengths
      return (this.opts.cellHeight as number) * (96 / 2.54);
    }
    if (this.opts.cellHeightUnit === 'mm') {
      return (this.opts.cellHeight as number) * (96 / 2.54) / 10;
    }
    // else get first cell height
    const el = this.el.querySelector('.' + this.opts.itemClass) as HTMLElement;
    if (el) {
      const h = Utils.toNumber(el.getAttribute('gs-h')) || 1; // since we don't write 1 anymore
      return Math.round(el.offsetHeight / h);
    }
    // else do entire grid and # of rows (but doesn't work if min-height is the actual constrain)
    const rows = parseInt(this.el.getAttribute('gs-current-row'));
    return rows ? Math.round(this.el.getBoundingClientRect().height / rows) : this.opts.cellHeight as number;
  }

  /**
   * Update current cell height - see `GridStackOptions.cellHeight` for format.
   * This method rebuilds an internal CSS style sheet.
   * Note: You can expect performance issues if call this method too often.
   *
   * @param val the cell height. If not passed (undefined), cells content will be made square (match width minus margin),
   * if pass 0 the CSS will be generated by the application instead.
   *
   * @example
   * grid.cellHeight(100); // same as 100px
   * grid.cellHeight('70px');
   * grid.cellHeight(grid.cellWidth() * 1.2);
   */
  public cellHeight(val?: numberOrString): GridStack {

    // if not called internally, check if we're changing mode
    if (val !== undefined) {
      if (this._isAutoCellHeight !== (val === 'auto')) {
        this._isAutoCellHeight = (val === 'auto');
        this._updateResizeEvent();
      }
    }
    if (val === 'initial' || val === 'auto') { val = undefined; }

    // make item content be square
    if (val === undefined) {
      const marginDiff = - (this.opts.marginRight as number) - (this.opts.marginLeft as number)
        + (this.opts.marginTop as number) + (this.opts.marginBottom as number);
      val = this.cellWidth() + marginDiff;
    }

    const data = Utils.parseHeight(val);
    if (this.opts.cellHeightUnit === data.unit && this.opts.cellHeight === data.h) {
      return this;
    }
    this.opts.cellHeightUnit = data.unit;
    this.opts.cellHeight = data.h;

    // finally update var and container
    this.el.style.setProperty('--gs-cell-height', `${this.opts.cellHeight}${this.opts.cellHeightUnit}`);
    this._updateContainerHeight();
    this.resizeToContentCheck();

    return this;
  }

  /** Gets current cell width. */
  public cellWidth(): number {
    return this._widthOrContainer() / this.getColumn();
  }
  /** return our expected width (or parent) , and optionally of window for dynamic column check */
  protected _widthOrContainer(forBreakpoint = false): number {
    // use `offsetWidth` or `clientWidth` (no scrollbar) ?
    // https://stackoverflow.com/questions/21064101/understanding-offsetwidth-clientwidth-scrollwidth-and-height-respectively
    return forBreakpoint && this.opts.columnOpts?.breakpointForWindow ? window.innerWidth : (this.el.clientWidth || this.el.parentElement.clientWidth || window.innerWidth);
  }
  /** checks for dynamic column count for our current size, returning true if changed */
  protected checkDynamicColumn(): boolean {
    const resp = this.opts.columnOpts;
    if (!resp || (!resp.columnWidth && !resp.breakpoints?.length)) return false;
    const column = this.getColumn();
    let newColumn = column;
    const w = this._widthOrContainer(true);
    if (resp.columnWidth) {
      newColumn = Math.min(Math.round(w / resp.columnWidth) || 1, resp.columnMax);
    } else {
      // find the closest breakpoint (already sorted big to small) that matches
      newColumn = resp.columnMax;
      let i = 0;
      while (i < resp.breakpoints.length && w <= resp.breakpoints[i].w) {
        newColumn = resp.breakpoints[i++].c || column;
      }
    }
    if (newColumn !== column) {
      const bk = resp.breakpoints?.find(b => b.c === newColumn);
      this.column(newColumn, bk?.layout || resp.layout);
      return true;
    }
    return false;
  }

  /**
   * re-layout grid items to reclaim any empty space. Options are:
   * 'list' keep the widget left->right order the same, even if that means leaving an empty slot if things don't fit
   * 'compact' might re-order items to fill any empty space
   *
   * doSort - 'false' to let you do your own sorting ahead in case you need to control a different order. (default to sort)
   */
  public compact(layout: CompactOptions = 'compact', doSort = true): GridStack {
    this.engine.compact(layout, doSort);
    this._triggerChangeEvent();
    return this;
  }

  /**
   * set the number of columns in the grid. Will update existing widgets to conform to new number of columns,
   * as well as cache the original layout so you can revert back to previous positions without loss.
   * @param column - Integer > 0 (default 12).
   * @param layout specify the type of re-layout that will happen (position, size, etc...).
   * Note: items will never be outside of the current column boundaries. default ('moveScale'). Ignored for 1 column
   */
  public column(column: number, layout: ColumnOptions = 'moveScale'): GridStack {
    if (!column || column < 1 || this.opts.column === column) return this;

    const oldColumn = this.getColumn();
    this.opts.column = column;
    if (!this.engine) {
      // called in constructor, noting else to do but remember that breakpoint layout
      this.responseLayout = layout;
      return this;
    }

    this.engine.column = column;
    this.el.classList.remove('gs-' + oldColumn);
    this._updateColumnVar();

    // update the items now
    this.engine.columnChanged(oldColumn, column, layout);
    if (this._isAutoCellHeight) this.cellHeight();

    this.resizeToContentCheck(true); // wait for width resizing

    // and trigger our event last...
    this._ignoreLayoutsNodeChange = true; // skip layout update
    this._triggerChangeEvent();
    delete this._ignoreLayoutsNodeChange;

    return this;
  }

  /**
   * get the number of columns in the grid (default 12)
   */
  public getColumn(): number { return this.opts.column as number; }

  /** returns an array of grid HTML elements (no placeholder) - used to iterate through our children in DOM order */
  public getGridItems(): GridItemHTMLElement[] {
    return Array.from(this.el.children)
      .filter((el: HTMLElement) => el.matches('.' + this.opts.itemClass) && !el.matches('.' + this.opts.placeholderClass)) as GridItemHTMLElement[];
  }

  /** true if changeCB should be ignored due to column change, sizeToContent, loading, etc... which caller can ignore for dirty flag case */
  public isIgnoreChangeCB(): boolean { return this._ignoreLayoutsNodeChange; }

  /**
   * Destroys a grid instance. DO NOT CALL any methods or access any vars after this as it will free up members.
   * @param removeDOM if `false` grid and items HTML elements will not be removed from the DOM (Optional. Default `true`).
   */
  public destroy(removeDOM = true): GridStack {
    if (!this.el) return; // prevent multiple calls
    this.offAll();
    this._updateResizeEvent(true);
    this.setStatic(true, false); // permanently removes DD but don't set CSS class (we're going away)
    this.setAnimation(false);
    if (!removeDOM) {
      this.removeAll(removeDOM);
      this.el.removeAttribute('gs-current-row');
    } else {
      this.el.parentNode.removeChild(this.el);
    }
    if (this.parentGridNode) delete this.parentGridNode.subGrid;
    delete this.parentGridNode;
    delete this.opts;
    delete this._placeholder?.gridstackNode;
    delete this._placeholder;
    delete this.engine;
    delete this.el.gridstack; // remove circular dependency that would prevent a freeing
    delete this.el;
    return this;
  }

  /**
   * enable/disable floating widgets (default: `false`) See [example](http://gridstackjs.com/demo/float.html)
   */
  public float(val: boolean): GridStack {
    if (this.opts.float !== val) {
      this.opts.float = this.engine.float = val;
      this._triggerChangeEvent();
    }
    return this;
  }

  /**
   * get the current float mode
   */
  public getFloat(): boolean {
    return this.engine.float;
  }

  /**
   * Get the position of the cell under a pixel on screen.
   * @param position the position of the pixel to resolve in
   * absolute coordinates, as an object with top and left properties
   * @param useDocRelative if true, value will be based on document position vs parent position (Optional. Default false).
   * Useful when grid is within `position: relative` element
   *
   * Returns an object with properties `x` and `y` i.e. the column and row in the grid.
   */
  public getCellFromPixel(position: MousePosition, useDocRelative = false): CellPosition {
    const box = this.el.getBoundingClientRect();
    // console.log(`getBoundingClientRect left: ${box.left} top: ${box.top} w: ${box.w} h: ${box.h}`)
    let containerPos: { top: number, left: number };
    if (useDocRelative) {
      containerPos = { top: box.top + document.documentElement.scrollTop, left: box.left };
      // console.log(`getCellFromPixel scrollTop: ${document.documentElement.scrollTop}`)
    } else {
      containerPos = { top: this.el.offsetTop, left: this.el.offsetLeft }
      // console.log(`getCellFromPixel offsetTop: ${containerPos.left} offsetLeft: ${containerPos.top}`)
    }
    const relativeLeft = position.left - containerPos.left;
    const relativeTop = position.top - containerPos.top;

    const columnWidth = (box.width / this.getColumn());
    const rowHeight = (box.height / parseInt(this.el.getAttribute('gs-current-row')));

    return { x: Math.floor(relativeLeft / columnWidth), y: Math.floor(relativeTop / rowHeight) };
  }

  /** returns the current number of rows, which will be at least `minRow` if set */
  public getRow(): number {
    return Math.max(this.engine.getRow(), this.opts.minRow || 0);
  }

  /**
   * Checks if specified area is empty.
   * @param x the position x.
   * @param y the position y.
   * @param w the width of to check
   * @param h the height of to check
   */
  public isAreaEmpty(x: number, y: number, w: number, h: number): boolean {
    return this.engine.isAreaEmpty(x, y, w, h);
  }

  /**
   * If you add elements to your grid by hand (or have some framework creating DOM), you have to tell gridstack afterwards to make them widgets.
   * If you want gridstack to add the elements for you, use `addWidget()` instead.
   * Makes the given element a widget and returns it.
   * @param els widget or single selector to convert.
   * @param options widget definition to use instead of reading attributes or using default sizing values
   *
   * @example
   * const grid = GridStack.init();
   * grid.el.innerHtml = '<div id="1" gs-w="3"></div><div id="2"></div>';
   * grid.makeWidget('1');
   * grid.makeWidget('2', {w:2, content: 'hello'});
   */
  public makeWidget(els: GridStackElement, options?: GridStackWidget): GridItemHTMLElement {
    const el = GridStack.getElement(els);
    if (!el || el.gridstackNode) return el;
    if (!el.parentElement) this.el.appendChild(el);
    this._prepareElement(el, true, options);
    const node = el.gridstackNode;

    this._updateContainerHeight();

    // see if there is a sub-grid to create
    if (node.subGridOpts) {
      this.makeSubGrid(el, node.subGridOpts, undefined, false); // node.subGrid will be used as option in method, no need to pass
    }

    // if we're adding an item into 1 column make sure
    // we don't override the larger 12 column layout that was already saved. #1985
    let resetIgnoreLayoutsNodeChange: boolean;
    if (this.opts.column === 1 && !this._ignoreLayoutsNodeChange) {
      resetIgnoreLayoutsNodeChange = this._ignoreLayoutsNodeChange = true;
    }
    this._triggerAddEvent();
    this._triggerChangeEvent();
    if (resetIgnoreLayoutsNodeChange) delete this._ignoreLayoutsNodeChange;

    return el;
  }

  /**
   * Event handler that extracts our CustomEvent data out automatically for receiving custom
   * notifications (see doc for supported events)
   * @param name of the event (see possible values) or list of names space separated
   * @param callback function called with event and optional second/third param
   * (see README documentation for each signature).
   *
   * @example
   * grid.on('added', function(e, items) { log('added ', items)} );
   * or
   * grid.on('added removed change', function(e, items) { log(e.type, items)} );
   *
   * Note: in some cases it is the same as calling native handler and parsing the event.
   * grid.el.addEventListener('added', function(event) { log('added ', event.detail)} );
   *
   */
  public on(name: 'dropped', callback: GridStackDroppedHandler): GridStack
  public on(name: 'enable' | 'disable', callback: GridStackEventHandler): GridStack
  public on(name: 'change' | 'added' | 'removed' | 'resizecontent', callback: GridStackNodesHandler): GridStack
  public on(name: 'resizestart' | 'resize' | 'resizestop' | 'dragstart' | 'drag' | 'dragstop', callback: GridStackElementHandler): GridStack
  public on(name: string, callback: GridStackEventHandlerCallback): GridStack
  public on(name: GridStackEvent | string, callback: GridStackEventHandlerCallback): GridStack {
    // check for array of names being passed instead
    if (name.indexOf(' ') !== -1) {
      const names = name.split(' ') as GridStackEvent[];
      names.forEach(name => this.on(name, callback));
      return this;
    }

    // native CustomEvent handlers - cash the generic handlers so we can easily remove
    if (name === 'change' || name === 'added' || name === 'removed' || name === 'enable' || name === 'disable') {
      const noData = (name === 'enable' || name === 'disable');
      if (noData) {
        this._gsEventHandler[name] = (event: Event) => (callback as GridStackEventHandler)(event);
      } else {
        this._gsEventHandler[name] = (event: CustomEvent) => {if (event.detail) (callback as GridStackNodesHandler)(event, event.detail)};
      }
      this.el.addEventListener(name, this._gsEventHandler[name]);
    } else if (name === 'drag' || name === 'dragstart' || name === 'dragstop' || name === 'resizestart' || name === 'resize'
      || name === 'resizestop' || name === 'dropped' || name === 'resizecontent') {
      // drag&drop stop events NEED to be call them AFTER we update node attributes so handle them ourself.
      // do same for start event to make it easier...
      this._gsEventHandler[name] = callback;
    } else {
      console.error('GridStack.on(' + name + ') event not supported');
    }
    return this;
  }

  /**
   * unsubscribe from the 'on' event GridStackEvent
   * @param name of the event (see possible values) or list of names space separated
   */
  public off(name: GridStackEvent | string): GridStack {
    // check for array of names being passed instead
    if (name.indexOf(' ') !== -1) {
      const names = name.split(' ') as GridStackEvent[];
      names.forEach(name => this.off(name));
      return this;
    }

    if (name === 'change' || name === 'added' || name === 'removed' || name === 'enable' || name === 'disable') {
      // remove native CustomEvent handlers
      if (this._gsEventHandler[name]) {
        this.el.removeEventListener(name, this._gsEventHandler[name]);
      }
    }
    delete this._gsEventHandler[name];

    return this;
  }

  /** remove all event handlers */
  public offAll(): GridStack {
    Object.keys(this._gsEventHandler).forEach((key: GridStackEvent) => this.off(key));
    return this;
  }

  /**
   * Removes widget from the grid.
   * @param el  widget or selector to modify
   * @param removeDOM if `false` DOM element won't be removed from the tree (Default? true).
   * @param triggerEvent if `false` (quiet mode) element will not be added to removed list and no 'removed' callbacks will be called (Default? true).
   */
  public removeWidget(els: GridStackElement, removeDOM = true, triggerEvent = true): GridStack {
    if (!els) { console.error('Error: GridStack.removeWidget(undefined) called'); return this; }

    GridStack.getElements(els).forEach(el => {
      if (el.parentElement && el.parentElement !== this.el) return; // not our child!
      let node = el.gridstackNode;
      // For Meteor support: https://github.com/gridstack/gridstack.js/pull/272
      if (!node) {
        node = this.engine.nodes.find(n => el === n.el);
      }
      if (!node) return;

      if (removeDOM && GridStack.addRemoveCB) {
        GridStack.addRemoveCB(this.el, node, false, false);
      }

      // remove our DOM data (circular link) and drag&drop permanently
      delete el.gridstackNode;
      this._removeDD(el);

      this.engine.removeNode(node, removeDOM, triggerEvent);

      if (removeDOM && el.parentElement) {
        el.remove(); // in batch mode engine.removeNode doesn't call back to remove DOM
      }
    });
    if (triggerEvent) {
      this._triggerRemoveEvent();
      this._triggerChangeEvent();
    }
    return this;
  }

  /**
   * Removes all widgets from the grid.
   * @param removeDOM if `false` DOM elements won't be removed from the tree (Default? `true`).
   * @param triggerEvent if `false` (quiet mode) element will not be added to removed list and no 'removed' callbacks will be called (Default? true).
   */
  public removeAll(removeDOM = true, triggerEvent = true): GridStack {
    // always remove our DOM data (circular link) before list gets emptied and drag&drop permanently
    this.engine.nodes.forEach(n => {
      if (removeDOM && GridStack.addRemoveCB) {
        GridStack.addRemoveCB(this.el, n, false, false);
      }
      delete n.el.gridstackNode;
      if (!this.opts.staticGrid) this._removeDD(n.el);
    });
    this.engine.removeAll(removeDOM, triggerEvent);
    if (triggerEvent) this._triggerRemoveEvent();
    return this;
  }

  /**
   * Toggle the grid animation state.  Toggles the `grid-stack-animate` class.
   * @param doAnimate if true the grid will animate.
   * @param delay if true setting will be set on next event loop.
   */
  public setAnimation(doAnimate = this.opts.animate, delay?: boolean): GridStack {
    if (delay) {
      // delay, but check to make sure grid (opt) is still around
      setTimeout(() => { if (this.opts) this.setAnimation(doAnimate) });
    } else if (doAnimate) {
      this.el.classList.add('grid-stack-animate');
    } else {
      this.el.classList.remove('grid-stack-animate');
    }
    this.opts.animate = doAnimate;
    return this;
  }

  /** @internal */
  private hasAnimationCSS(): boolean { return this.el.classList.contains('grid-stack-animate') }

  /**
   * Toggle the grid static state, which permanently removes/add Drag&Drop support, unlike disable()/enable() that just turns it off/on.
   * Also toggle the grid-stack-static class.
   * @param val if true the grid become static.
   * @param updateClass true (default) if css class gets updated
   * @param recurse true (default) if sub-grids also get updated
   */
  public setStatic(val: boolean, updateClass = true, recurse = true): GridStack {
    if (!!this.opts.staticGrid === val) return this;
    val ? this.opts.staticGrid = true : delete this.opts.staticGrid;
    this._setupRemoveDrop();
    this._setupAcceptWidget();
    this.engine.nodes.forEach(n => {
      this.prepareDragDrop(n.el); // either delete or init Drag&drop
      if (n.subGrid && recurse) n.subGrid.setStatic(val, updateClass, recurse);
    });
    if (updateClass) { this._setStaticClass(); }
    return this;
  }

  /**
   * Updates the passed in options on the grid (similar to update(widget) for for the grid options).
   * @param options PARTIAL grid options to update - only items specified will be updated.
   * NOTE: not all options updating are currently supported (lot of code, unlikely to change)
   */
  public updateOptions(o: GridStackOptions): GridStack {
    const opts = this.opts;
    if (o === opts) return this; // nothing to do
    if (o.acceptWidgets !== undefined) { opts.acceptWidgets = o.acceptWidgets; this._setupAcceptWidget(); }
    if (o.animate !== undefined) this.setAnimation(o.animate);
    if (o.cellHeight) this.cellHeight(o.cellHeight);
    if (o.class !== undefined && o.class !== opts.class) { if (opts.class) this.el.classList.remove(opts.class); if (o.class) this.el.classList.add(o.class); }
    // responsive column take over actual count (keep what we have now)
    if (o.columnOpts) {
      this.opts.columnOpts = o.columnOpts;
      this.checkDynamicColumn();
    } else if (o.columnOpts === null && this.opts.columnOpts) {
      delete this.opts.columnOpts;
      this._updateResizeEvent();
    } else if (typeof(o.column) === 'number') this.column(o.column);
    if (o.margin !== undefined) this.margin(o.margin);
    if (o.staticGrid !== undefined) this.setStatic(o.staticGrid);
    if (o.disableDrag !== undefined && !o.staticGrid) this.enableMove(!o.disableDrag);
    if (o.disableResize !== undefined && !o.staticGrid) this.enableResize(!o.disableResize);
    if (o.float !== undefined) this.float(o.float);
    if (o.row !== undefined) {
      opts.minRow = opts.maxRow = opts.row = o.row;
      this._updateContainerHeight();
    } else {
      if (o.minRow !== undefined) { opts.minRow = o.minRow; this._updateContainerHeight(); }
      if (o.maxRow !== undefined) opts.maxRow = o.maxRow;
    }
    if (o.children?.length) this.load(o.children);
    // TBD if we have a real need for these (more complex code)
    // alwaysShowResizeHandle, draggable, handle, handleClass, itemClass, layout, placeholderClass, placeholderText, resizable, removable, row,...
    return this;
  }

  /**
   * Updates widget position/size and other info. Note: if you need to call this on all nodes, use load() instead which will update what changed.
   * @param els  widget or selector of objects to modify (note: setting the same x,y for multiple items will be indeterministic and likely unwanted)
   * @param opt new widget options (x,y,w,h, etc..). Only those set will be updated.
   */
  public update(els: GridStackElement, opt: GridStackWidget): GridStack {

    GridStack.getElements(els).forEach(el => {
      const n = el?.gridstackNode;
      if (!n) return;
      const w = {...Utils.copyPos({}, n), ...Utils.cloneDeep(opt)}; // make a copy we can modify in case they re-use it or multiple items
      this.engine.nodeBoundFix(w);
      delete w.autoPosition;

      // move/resize widget if anything changed
      const keys = ['x', 'y', 'w', 'h'];
      let m: GridStackWidget;
      if (keys.some(k => w[k] !== undefined && w[k] !== n[k])) {
        m = {};
        keys.forEach(k => {
          m[k] = (w[k] !== undefined) ? w[k] : n[k];
          delete w[k];
        });
      }
      // for a move as well IFF there is any min/max fields set
      if (!m && (w.minW || w.minH || w.maxW || w.maxH)) {
        m = {}; // will use node position but validate values
      }

      // check for content changing
      if (w.content !== undefined) {
        const itemContent = el.querySelector('.grid-stack-item-content') as HTMLElement;
        if (itemContent && itemContent.textContent !== w.content) {
          n.content = w.content;
          GridStack.renderCB(itemContent, w);
          // restore any sub-grid back
          if (n.subGrid?.el) {
            itemContent.appendChild(n.subGrid.el);
            n.subGrid._updateContainerHeight();
          }
        }
        delete w.content;
      }

      // any remaining fields are assigned, but check for dragging changes, resize constrain
      let changed = false;
      let ddChanged = false;
      for (const key in w) {
        if (key[0] !== '_' && n[key] !== w[key]) {
          n[key] = w[key];
          changed = true;
          ddChanged = ddChanged || (!this.opts.staticGrid && (key === 'noResize' || key === 'noMove' || key === 'locked'));
        }
      }
      Utils.sanitizeMinMax(n);

      // finally move the widget and update attr
      if (m) {
        const widthChanged = (m.w !== undefined && m.w !== n.w);
        this.moveNode(n, m);
        if (widthChanged && n.subGrid) {
          // if we're animating the client size hasn't changed yet, so force a change (not exact size)
          n.subGrid.onResize(this.hasAnimationCSS() ? n.w : undefined);
        } else {
          this.resizeToContentCheck(widthChanged, n);
        }
        delete n._orig; // clear out original position now that we moved #2669
      }
      if (m || changed) {
        this._writeAttr(el, n);
      }
      if (ddChanged) {
        this.prepareDragDrop(n.el);
      }
      if (GridStack.updateCB) GridStack.updateCB(n); // call user callback so they know widget got updated
    });

    return this;
  }

  private moveNode(n: GridStackNode, m: GridStackMoveOpts) {
    const wasUpdating = n._updating;
    if (!wasUpdating) this.engine.cleanNodes().beginUpdate(n);
    this.engine.moveNode(n, m);
    this._updateContainerHeight();
    if (!wasUpdating) {
      this._triggerChangeEvent();
      this.engine.endUpdate();
    }
  }

  /**
   * Updates widget height to match the content height to avoid v-scrollbar or dead space.
   * Note: this assumes only 1 child under resizeToContentParent='.grid-stack-item-content' (sized to gridItem minus padding) that is at the entire content size wanted.
   * @param el grid item element
   * @param useNodeH set to true if GridStackNode.h should be used instead of actual container height when we don't need to wait for animation to finish to get actual DOM heights
   */
  public resizeToContent(el: GridItemHTMLElement) {
    if (!el) return;
    el.classList.remove('size-to-content-max');
    if (!el.clientHeight) return; // 0 when hidden, skip
    const n = el.gridstackNode;
    if (!n) return;
    const grid = n.grid;
    if (!grid || el.parentElement !== grid.el) return; // skip if we are not inside a grid
    const cell = grid.getCellHeight(true);
    if (!cell) return;
    let height = n.h ? n.h * cell : el.clientHeight; // getBoundingClientRect().height seem to flicker back and forth
    let item: Element;
    if (n.resizeToContentParent) item = el.querySelector(n.resizeToContentParent);
    if (!item) item = el.querySelector(GridStack.resizeToContentParent);
    if (!item) return;
    const padding = el.clientHeight - item.clientHeight; // full - available height to our child (minus border, padding...)
    const itemH = n.h ? n.h * cell - padding : item.clientHeight; // calculated to what cellHeight is or will become (rather than actual to prevent waiting for animation to finish)
    let wantedH: number;
    if (n.subGrid) {
      // sub-grid - use their actual row count * their cell height, BUT append any content outside of the grid (eg: above text)
      wantedH = n.subGrid.getRow() * n.subGrid.getCellHeight(true);
      const subRec = n.subGrid.el.getBoundingClientRect();
      const parentRec = el.getBoundingClientRect();
      wantedH += subRec.top - parentRec.top;
    } else if (n.subGridOpts?.children?.length) {
      // not sub-grid just yet (case above) wait until we do
      return;
    } else {
      // NOTE: clientHeight & getBoundingClientRect() is undefined for text and other leaf nodes. use <div> container!
      const child = item.firstElementChild;
      if (!child) {
        console.error(`Error: GridStack.resizeToContent() widget id:${n.id} '${GridStack.resizeToContentParent}'.firstElementChild is null, make sure to have a div like container. Skipping sizing.`);
        return;
      }
      wantedH = child.getBoundingClientRect().height || itemH;
    }
    if (itemH === wantedH) return;
    height += wantedH - itemH;
    let h = Math.ceil(height / cell);
    // check for min/max and special sizing
    const softMax = Number.isInteger(n.sizeToContent) ? n.sizeToContent as number : 0;
    if (softMax && h > softMax) {
      h = softMax;
      el.classList.add('size-to-content-max');  // get v-scroll back
    }
    if (n.minH && h < n.minH) h = n.minH;
    else if (n.maxH && h > n.maxH) h = n.maxH;
    if (h !== n.h) {
      grid._ignoreLayoutsNodeChange = true;
      grid.moveNode(n, { h });
      delete grid._ignoreLayoutsNodeChange;
    }
  }

  /** call the user resize (so they can do extra work) else our build in version */
  private resizeToContentCBCheck(el: GridItemHTMLElement) {
    if (GridStack.resizeToContentCB) GridStack.resizeToContentCB(el);
    else this.resizeToContent(el);
  }

  /** rotate (by swapping w & h) the passed in node - called when user press 'r' during dragging
   * @param els  widget or selector of objects to modify
   * @param relative optional pixel coord relative to upper/left corner to rotate around (will keep that cell under cursor)
   */
  public rotate(els: GridStackElement, relative?: Position): GridStack {
    GridStack.getElements(els).forEach(el => {
      const n = el.gridstackNode;
      if (!Utils.canBeRotated(n)) return;
      const rot: GridStackWidget = { w: n.h, h: n.w, minH: n.minW, minW: n.minH, maxH: n.maxW, maxW: n.maxH };
      // if given an offset, adjust x/y by column/row bounds when user presses 'r' during dragging
      if (relative) {
        const pivotX = relative.left > 0 ? Math.floor(relative.left / this.cellWidth()) : 0;
        const pivotY = relative.top > 0 ? Math.floor(relative.top / (this.opts.cellHeight as number)) : 0;
        rot.x = n.x + pivotX - (n.h - (pivotY+1));
        rot.y = (n.y + pivotY) - pivotX;
      }
      Object.keys(rot).forEach(k => { if (rot[k] === undefined) delete rot[k]; });
      const _orig = n._orig;
      this.update(el, rot);
      n._orig = _orig; // restore as move() will delete it
    });
    return this;
  }

  /**
   * Updates the margins which will set all 4 sides at once - see `GridStackOptions.margin` for format options (CSS string format of 1,2,4 values or single number).
   * @param value margin value
   */
  public margin(value: numberOrString): GridStack {
    const isMultiValue = (typeof value === 'string' && value.split(' ').length > 1);
    // check if we can skip... won't check if multi values (too much hassle)
    if (!isMultiValue) {
      const data = Utils.parseHeight(value);
      if (this.opts.marginUnit === data.unit && this.opts.margin === data.h) return;
    }
    // re-use existing margin handling
    this.opts.margin = value;
    this.opts.marginTop = this.opts.marginBottom = this.opts.marginLeft = this.opts.marginRight = undefined;
    this._initMargin();

    return this;
  }

  /** returns current margin number value (undefined if 4 sides don't match) */
  public getMargin(): number { return this.opts.margin as number; }

  /**
   * Returns true if the height of the grid will be less than the vertical
   * constraint. Always returns true if grid doesn't have height constraint.
   * @param node contains x,y,w,h,auto-position options
   *
   * @example
   * if (grid.willItFit(newWidget)) {
   *   grid.addWidget(newWidget);
   * } else {
   *   alert('Not enough free space to place the widget');
   * }
   */
  public willItFit(node: GridStackWidget): boolean {
    // support legacy call for now
    if (arguments.length > 1) {
      console.warn('gridstack.ts: `willItFit(x,y,w,h,autoPosition)` is deprecated. Use `willItFit({x, y,...})`. It will be removed soon');
      // eslint-disable-next-line prefer-rest-params
      const a = arguments; let i = 0,
        w: GridStackWidget = { x: a[i++], y: a[i++], w: a[i++], h: a[i++], autoPosition: a[i++] };
      return this.willItFit(w);
    }
    return this.engine.willItFit(node);
  }

  /** @internal */
  protected _triggerChangeEvent(): GridStack {
    if (this.engine.batchMode) return this;
    const elements = this.engine.getDirtyNodes(true); // verify they really changed
    if (elements && elements.length) {
      if (!this._ignoreLayoutsNodeChange) {
        this.engine.layoutsNodesChange(elements);
      }
      this._triggerEvent('change', elements);
    }
    this.engine.saveInitial(); // we called, now reset initial values & dirty flags
    return this;
  }

  /** @internal */
  protected _triggerAddEvent(): GridStack {
    if (this.engine.batchMode) return this;
    if (this.engine.addedNodes?.length) {
      if (!this._ignoreLayoutsNodeChange) {
        this.engine.layoutsNodesChange(this.engine.addedNodes);
      }
      // prevent added nodes from also triggering 'change' event (which is called next)
      this.engine.addedNodes.forEach(n => { delete n._dirty; });
      const addedNodes = [...this.engine.addedNodes];
      this.engine.addedNodes = [];
      this._triggerEvent('added', addedNodes);
    }
    return this;
  }

  /** @internal */
  public _triggerRemoveEvent(): GridStack {
    if (this.engine.batchMode) return this;
    if (this.engine.removedNodes?.length) {
      const removedNodes = [...this.engine.removedNodes];
      this.engine.removedNodes = [];
      this._triggerEvent('removed', removedNodes);
    }
    return this;
  }

  /** @internal */
  protected _triggerEvent(type: string, data?: GridStackNode[]): GridStack {
    const event = data ? new CustomEvent(type, { bubbles: false, detail: data }) : new Event(type);
    // check if we're nested, and if so call the outermost grid to trigger the event
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let grid: GridStack = this;
    while (grid.parentGridNode) grid = grid.parentGridNode.grid;
    grid.el.dispatchEvent(event);
    return this;
  }

  /** @internal */
  protected _updateContainerHeight(): GridStack {
    if (!this.engine || this.engine.batchMode) return this;
    const parent = this.parentGridNode;
    let row = this.getRow() + this._extraDragRow; // this checks for minRow already
    const cellHeight = this.opts.cellHeight as number;
    const unit = this.opts.cellHeightUnit;
    if (!cellHeight) return this;

    // check for css min height (non nested grid). TODO: support mismatch, say: min % while unit is px.
    // If `minRow` was applied, don't override it with this check, and avoid performance issues
    // (reflows) using `getComputedStyle`
    if (!parent && !this.opts.minRow) {
      const cssMinHeight = Utils.parseHeight(getComputedStyle(this.el)['minHeight']);
      if (cssMinHeight.h > 0 && cssMinHeight.unit === unit) {
        const minRow = Math.floor(cssMinHeight.h / cellHeight);
        if (row < minRow) {
          row = minRow;
        }
      }
    }

    this.el.setAttribute('gs-current-row', String(row));
    this.el.style.removeProperty('min-height');
    this.el.style.removeProperty('height');
    if (row) {
      // nested grids have 'insert:0' to fill the space of parent by default, but we may be taller so use min-height for possible scrollbars
      this.el.style[parent ? 'minHeight' : 'height'] = row * cellHeight + unit;
    }

    // if we're a nested grid inside an sizeToContent item, tell it to resize itself too
    if (parent && Utils.shouldSizeToContent(parent)) {
      parent.grid.resizeToContentCBCheck(parent.el);
    }

    return this;
  }

  /** @internal */
  protected _prepareElement(el: GridItemHTMLElement, triggerAddEvent = false, node?: GridStackNode): GridStack {
    node = node || this._readAttr(el);
    el.gridstackNode = node;
    node.el = el;
    node.grid = this;
    node = this.engine.addNode(node, triggerAddEvent);

    // write the dom sizes and class
    this._writeAttr(el, node);
    el.classList.add(gridDefaults.itemClass, this.opts.itemClass);
    const sizeToContent = Utils.shouldSizeToContent(node);
    sizeToContent ? el.classList.add('size-to-content') : el.classList.remove('size-to-content');
    if (sizeToContent) this.resizeToContentCheck(false, node);

    if (!Utils.lazyLoad(node)) this.prepareDragDrop(node.el);

    return this;
  }

  /** @internal write position CSS vars and x,y,w,h attributes (not used for CSS but by users) back to element */
  protected _writePosAttr(el: HTMLElement, n: GridStackNode): GridStack {
    // Avoid overwriting the inline style of the element during drag/resize, but always update the placeholder
    if ((!n._moving && !n._resizing) || this._placeholder === el) {
      // width/height:1 x/y:0 is set by default in the main CSS, so no need to set inlined vars
      el.style.top = n.y ? (n.y === 1 ? `var(--gs-cell-height)` : `calc(${n.y} * var(--gs-cell-height))`) : null;
      el.style.left = n.x ? (n.x === 1 ? `var(--gs-column-width)` : `calc(${n.x} * var(--gs-column-width))`) : null;
      el.style.width = n.w > 1 ? `calc(${n.w} * var(--gs-column-width))` : null;
      el.style.height = n.h > 1 ? `calc(${n.h} * var(--gs-cell-height))` : null;
    }
    // NOTE: those are technically not needed anymore (v12+) as we have CSS vars for everything, but some users depends on them to render item size using CSS
    n.x > 0 ? el.setAttribute('gs-x', String(n.x)) : el.removeAttribute('gs-x');
    n.y > 0 ? el.setAttribute('gs-y', String(n.y)) : el.removeAttribute('gs-y');
    n.w > 1 ? el.setAttribute('gs-w', String(n.w)) : el.removeAttribute('gs-w');
    n.h > 1 ? el.setAttribute('gs-h', String(n.h)) : el.removeAttribute('gs-h');
    return this;
  }

  /** @internal call to write any default attributes back to element */
  protected _writeAttr(el: HTMLElement, node: GridStackNode): GridStack {
    if (!node) return this;
    this._writePosAttr(el, node);

    const attrs /*: GridStackWidget but strings */ = { // remaining attributes
      // autoPosition: 'gs-auto-position', // no need to write out as already in node and doesn't affect CSS
      noResize: 'gs-no-resize',
      noMove: 'gs-no-move',
      locked: 'gs-locked',
      id: 'gs-id',
      sizeToContent: 'gs-size-to-content',
    };
    for (const key in attrs) {
      if (node[key]) { // 0 is valid for x,y only but done above already and not in list anyway
        el.setAttribute(attrs[key], String(node[key]));
      } else {
        el.removeAttribute(attrs[key]);
      }
    }
    return this;
  }

  /** @internal call to read any default attributes from element */
  protected _readAttr(el: HTMLElement, clearDefaultAttr = true): GridStackWidget {
    const n: GridStackNode = {};
    n.x = Utils.toNumber(el.getAttribute('gs-x'));
    n.y = Utils.toNumber(el.getAttribute('gs-y'));
    n.w = Utils.toNumber(el.getAttribute('gs-w'));
    n.h = Utils.toNumber(el.getAttribute('gs-h'));
    n.autoPosition = Utils.toBool(el.getAttribute('gs-auto-position'));
    n.noResize = Utils.toBool(el.getAttribute('gs-no-resize'));
    n.noMove = Utils.toBool(el.getAttribute('gs-no-move'));
    n.locked = Utils.toBool(el.getAttribute('gs-locked'));
    const attr = el.getAttribute('gs-size-to-content');
    if (attr) {
      if (attr === 'true' || attr === 'false') n.sizeToContent = Utils.toBool(attr);
      else n.sizeToContent = parseInt(attr, 10);
    }
    n.id = el.getAttribute('gs-id');

    // read but never written out
    n.maxW = Utils.toNumber(el.getAttribute('gs-max-w'));
    n.minW = Utils.toNumber(el.getAttribute('gs-min-w'));
    n.maxH = Utils.toNumber(el.getAttribute('gs-max-h'));
    n.minH = Utils.toNumber(el.getAttribute('gs-min-h'));

    // v8.x optimization to reduce un-needed attr that don't render or are default CSS
    if (clearDefaultAttr) {
      if (n.w === 1) el.removeAttribute('gs-w');
      if (n.h === 1) el.removeAttribute('gs-h');
      if (n.maxW) el.removeAttribute('gs-max-w');
      if (n.minW) el.removeAttribute('gs-min-w');
      if (n.maxH) el.removeAttribute('gs-max-h');
      if (n.minH) el.removeAttribute('gs-min-h');
    }

    // remove any key not found (null or false which is default, unless sizeToContent=false override)
    for (const key in n) {
      if (!n.hasOwnProperty(key)) return;
      if (!n[key] && n[key] !== 0 && key !== 'sizeToContent') { // 0 can be valid value (x,y only really)
        delete n[key];
      }
    }

    return n;
  }

  /** @internal */
  protected _setStaticClass(): GridStack {
    const classes = ['grid-stack-static'];

    if (this.opts.staticGrid) {
      this.el.classList.add(...classes);
      this.el.setAttribute('gs-static', 'true');
    } else {
      this.el.classList.remove(...classes);
      this.el.removeAttribute('gs-static');

    }
    return this;
  }

  /**
   * called when we are being resized - check if the one Column Mode needs to be turned on/off
   * and remember the prev columns we used, or get our count from parent, as well as check for cellHeight==='auto' (square)
   * or `sizeToContent` gridItem options.
   */
  public onResize(clientWidth = this.el?.clientWidth): GridStack {
    if (!clientWidth) return; // return if we're gone or no size yet (will get called again)
    if (this.prevWidth === clientWidth) return; // no-op
    this.prevWidth = clientWidth
    // console.log('onResize ', clientWidth);

    this.batchUpdate();

    // see if we're nested and take our column count from our parent....
    let columnChanged = false;
    if (this._autoColumn && this.parentGridNode) {
      if (this.opts.column !== this.parentGridNode.w) {
        this.column(this.parentGridNode.w, this.opts.layout || 'list');
        columnChanged = true;
      }
    } else {
      // else check for dynamic column
      columnChanged = this.checkDynamicColumn();
    }

    // make the cells content square again
    if (this._isAutoCellHeight) this.cellHeight();

    // update any nested grids, or items size
    this.engine.nodes.forEach(n => {
      if (n.subGrid) n.subGrid.onResize()
    });

    if (!this._skipInitialResize) this.resizeToContentCheck(columnChanged); // wait for anim of column changed (DOM reflow before we can size correctly)
    delete this._skipInitialResize;

    this.batchUpdate(false);

    return this;
  }

  /** resizes content for given node (or all) if shouldSizeToContent() is true */
  private resizeToContentCheck(delay = false, n: GridStackNode = undefined) {
    if (!this.engine) return; // we've been deleted in between!

    // update any gridItem height with sizeToContent, but wait for DOM $animation_speed to settle if we changed column count
    // TODO: is there a way to know what the final (post animation) size of the content will be so we can animate the column width and height together rather than sequentially ?
    if (delay && this.hasAnimationCSS()) return setTimeout(() => this.resizeToContentCheck(false, n), this.animationDelay);

    if (n) {
      if (Utils.shouldSizeToContent(n)) this.resizeToContentCBCheck(n.el);
    } else if (this.engine.nodes.some(n => Utils.shouldSizeToContent(n))) {
      const nodes = [...this.engine.nodes]; // in case order changes while resizing one
      this.batchUpdate();
      nodes.forEach(n => {
        if (Utils.shouldSizeToContent(n)) this.resizeToContentCBCheck(n.el);
      });
      this._ignoreLayoutsNodeChange = true; // loop through each node will set/reset around each move, so set it here again
      this.batchUpdate(false);
      this._ignoreLayoutsNodeChange = false;
    }
    // call this regardless of shouldSizeToContent because widget might need to stretch to take available space after a resize
    if (this._gsEventHandler['resizecontent']) this._gsEventHandler['resizecontent'](null, n ? [n] : this.engine.nodes);
  }

  /** add or remove the grid element size event handler */
  protected _updateResizeEvent(forceRemove = false): GridStack {
    // only add event if we're not nested (parent will call us) and we're auto sizing cells or supporting dynamic column (i.e. doing work)
    // or supporting new sizeToContent option.
    const trackSize = !this.parentGridNode && (this._isAutoCellHeight || this.opts.sizeToContent || this.opts.columnOpts
      || this.engine.nodes.find(n => n.sizeToContent));

    if (!forceRemove && trackSize && !this.resizeObserver) {
      this._sizeThrottle = Utils.throttle(() => this.onResize(), this.opts.cellHeightThrottle);
      this.resizeObserver = new ResizeObserver(() => this._sizeThrottle());
      this.resizeObserver.observe(this.el);
      this._skipInitialResize = true; // makeWidget will originally have called on startup
    } else if ((forceRemove || !trackSize) && this.resizeObserver) {
      this.resizeObserver.disconnect();
      delete this.resizeObserver;
      delete this._sizeThrottle;
    }

    return this;
  }

  /** @internal convert a potential selector into actual element */
  public static getElement(els: GridStackElement = '.grid-stack-item'): GridItemHTMLElement { return Utils.getElement(els) }
  /** @internal */
  public static getElements(els: GridStackElement = '.grid-stack-item'): GridItemHTMLElement[] { return Utils.getElements(els) }
  /** @internal */
  public static getGridElement(els: GridStackElement): GridHTMLElement { return GridStack.getElement(els) }
  /** @internal */
  public static getGridElements(els: string): GridHTMLElement[] { return Utils.getElements(els) }

  /** @internal initialize margin top/bottom/left/right and units */
  protected _initMargin(): GridStack {
    let data: HeightData;
    let margin = 0;

    // support passing multiple values like CSS (ex: '5px 10px 0 20px')
    let margins: string[] = [];
    if (typeof this.opts.margin === 'string') {
      margins = this.opts.margin.split(' ')
    }
    if (margins.length === 2) { // top/bot, left/right like CSS
      this.opts.marginTop = this.opts.marginBottom = margins[0];
      this.opts.marginLeft = this.opts.marginRight = margins[1];
    } else if (margins.length === 4) { // Clockwise like CSS
      this.opts.marginTop = margins[0];
      this.opts.marginRight = margins[1];
      this.opts.marginBottom = margins[2];
      this.opts.marginLeft = margins[3];
    } else {
      data = Utils.parseHeight(this.opts.margin);
      this.opts.marginUnit = data.unit;
      margin = this.opts.margin = data.h;
    }

    // see if top/bottom/left/right need to be set as well
    const keys = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'];
    keys.forEach(k => {
      if (this.opts[k] === undefined) {
        this.opts[k] = margin;
      } else {
        data = Utils.parseHeight(this.opts[k]);
        this.opts[k] = data.h;
        delete this.opts.margin;
      }
    });
    this.opts.marginUnit = data.unit; // in case side were spelled out, use those units instead...
    if (this.opts.marginTop === this.opts.marginBottom && this.opts.marginLeft === this.opts.marginRight && this.opts.marginTop === this.opts.marginRight) {
      this.opts.margin = this.opts.marginTop; // makes it easier to check for no-ops in setMargin()
    }

    // finally Update the CSS margin variables (inside the cell height) */
    const style = this.el.style;
    style.setProperty('--gs-item-margin-top', `${this.opts.marginTop}${this.opts.marginUnit}`);
    style.setProperty('--gs-item-margin-bottom', `${this.opts.marginBottom}${this.opts.marginUnit}`);
    style.setProperty('--gs-item-margin-right', `${this.opts.marginRight}${this.opts.marginUnit}`);
    style.setProperty('--gs-item-margin-left', `${this.opts.marginLeft}${this.opts.marginUnit}`);

    return this;
  }

  static GDRev = '12.2.2-dev';

  /* ===========================================================================================
   * drag&drop methods that used to be stubbed out and implemented in dd-gridstack.ts
   * but caused loading issues in prod - see https://github.com/gridstack/gridstack.js/issues/2039
   * ===========================================================================================
   */

  /** get the global (but static to this code) DD implementation */
  public static getDD(): DDGridStack {
    return dd;
  }

  /**
   * call to setup dragging in from the outside (say toolbar), by specifying the class selection and options.
   * Called during GridStack.init() as options, but can also be called directly (last param are used) in case the toolbar
   * is dynamically create and needs to be set later.
   * @param dragIn string selector (ex: '.sidebar-item') or list of dom elements
   * @param dragInOptions options - see DDDragOpt. (default: {handle: '.grid-stack-item-content', appendTo: 'body'}
   * @param widgets GridStackWidget def to assign to each element which defines what to create on drop
   * @param root optional root which defaults to document (for shadow dom pass the parent HTMLDocument)
   */
  public static setupDragIn(dragIn?: string | HTMLElement[], dragInOptions?: DDDragOpt, widgets?: GridStackWidget[], root: HTMLElement | Document = document): void {
    if (dragInOptions?.pause !== undefined) {
      DDManager.pauseDrag = dragInOptions.pause;
    }

    dragInOptions = { appendTo: 'body', helper: 'clone', ...(dragInOptions || {}) }; // default to handle:undefined = drag by the whole item
    const els = (typeof dragIn === 'string') ? Utils.getElements(dragIn, root) : dragIn;
    els.forEach((el, i) => {
      if (!dd.isDraggable(el)) dd.dragIn(el, dragInOptions);
      if (widgets?.[i]) (el as GridItemHTMLElement).gridstackNode = widgets[i];
    });
  }

  /**
   * Enables/Disables dragging by the user of specific grid element. If you want all items, and have it affect future items, use enableMove() instead. No-op for static grids.
   * IF you are looking to prevent an item from moving (due to being pushed around by another during collision) use locked property instead.
   * @param els widget or selector to modify.
   * @param val if true widget will be draggable, assuming the parent grid isn't noMove or static.
   */
  public movable(els: GridStackElement, val: boolean): GridStack {
    if (this.opts.staticGrid) return this; // can't move a static grid!
    GridStack.getElements(els).forEach(el => {
      const n = el.gridstackNode;
      if (!n) return;
      val ? delete n.noMove : n.noMove = true;
      this.prepareDragDrop(n.el); // init DD if need be, and adjust
    });
    return this;
  }

  /**
   * Enables/Disables user resizing of specific grid element. If you want all items, and have it affect future items, use enableResize() instead. No-op for static grids.
   * @param els  widget or selector to modify
   * @param val  if true widget will be resizable, assuming the parent grid isn't noResize or static.
   */
  public resizable(els: GridStackElement, val: boolean): GridStack {
    if (this.opts.staticGrid) return this; // can't resize a static grid!
    GridStack.getElements(els).forEach(el => {
      const n = el.gridstackNode;
      if (!n) return;
      val ? delete n.noResize : n.noResize = true;
      this.prepareDragDrop(n.el); // init DD if need be, and adjust
    });
    return this;
  }

  /**
   * Temporarily disables widgets moving/resizing.
   * If you want a more permanent way (which freezes up resources) use `setStatic(true)` instead.
   * Note: no-op for static grid
   * This is a shortcut for:
   * @example
   *  grid.enableMove(false);
   *  grid.enableResize(false);
   * @param recurse true (default) if sub-grids also get updated
   */
  public disable(recurse = true): GridStack {
    if (this.opts.staticGrid) return;
    this.enableMove(false, recurse);
    this.enableResize(false, recurse);
    this._triggerEvent('disable');
    return this;
  }
  /**
   * Re-enables widgets moving/resizing - see disable().
   * Note: no-op for static grid.
   * This is a shortcut for:
   * @example
   *  grid.enableMove(true);
   *  grid.enableResize(true);
   * @param recurse true (default) if sub-grids also get updated
   */
  public enable(recurse = true): GridStack {
    if (this.opts.staticGrid) return;
    this.enableMove(true, recurse);
    this.enableResize(true, recurse);
    this._triggerEvent('enable');
    return this;
  }

  /**
   * Enables/disables widget moving. No-op for static grids, and locally defined items still overrule
   * @param recurse true (default) if sub-grids also get updated
   */
  public enableMove(doEnable: boolean, recurse = true): GridStack {
    if (this.opts.staticGrid) return this; // can't move a static grid!
    doEnable ? delete this.opts.disableDrag : this.opts.disableDrag = true; // FIRST before we update children as grid overrides #1658
    this.engine.nodes.forEach(n => {
      this.prepareDragDrop(n.el);
      if (n.subGrid && recurse) n.subGrid.enableMove(doEnable, recurse);
    });
    return this;
  }

  /**
   * Enables/disables widget resizing. No-op for static grids.
   * @param recurse true (default) if sub-grids also get updated
   */
  public enableResize(doEnable: boolean, recurse = true): GridStack {
    if (this.opts.staticGrid) return this; // can't size a static grid!
    doEnable ? delete this.opts.disableResize : this.opts.disableResize = true; // FIRST before we update children as grid overrides #1658
    this.engine.nodes.forEach(n => {
      this.prepareDragDrop(n.el);
      if (n.subGrid && recurse) n.subGrid.enableResize(doEnable, recurse);
    });
    return this;
  }

  /** @internal call when drag (and drop) needs to be cancelled (Esc key) */
  public cancelDrag() {
    const n = this._placeholder?.gridstackNode;
    if (!n) return;
    if (n._isExternal) {
      // remove any newly inserted nodes (from outside)
      n._isAboutToRemove = true;
      this.engine.removeNode(n);
    } else if (n._isAboutToRemove) {
      // restore any temp removed (dragged over trash)
      GridStack._itemRemoving(n.el, false);
    }

    this.engine.restoreInitial();
  }

  /** @internal removes any drag&drop present (called during destroy) */
  protected _removeDD(el: DDElementHost): GridStack {
    dd.draggable(el, 'destroy').resizable(el, 'destroy');
    if (el.gridstackNode) {
      delete el.gridstackNode._initDD; // reset our DD init flag
    }
    delete el.ddElement;
    return this;
  }

  /** @internal called to add drag over to support widgets being added externally */
  protected _setupAcceptWidget(): GridStack {

    // check if we need to disable things
    if (this.opts.staticGrid || (!this.opts.acceptWidgets && !this.opts.removable)) {
      dd.droppable(this.el, 'destroy');
      return this;
    }

    // vars shared across all methods
    let cellHeight: number, cellWidth: number;

    const onDrag = (event: DragEvent, el: GridItemHTMLElement, helper: GridItemHTMLElement) => {
      helper = helper || el;
      const node = helper.gridstackNode;
      if (!node) return;

      // if the element is being dragged from outside, scale it down to match the grid's scale
      // and slightly adjust its position relative to the mouse
      if (!node.grid?.el) {
        // this scales the helper down
        helper.style.transform = `scale(${1 / this.dragTransform.xScale},${1 / this.dragTransform.yScale})`;
        // this makes it so that the helper is well positioned relative to the mouse after scaling
        const helperRect = helper.getBoundingClientRect();
        helper.style.left = helperRect.x + (this.dragTransform.xScale - 1) * (event.clientX - helperRect.x) / this.dragTransform.xScale + 'px';
        helper.style.top = helperRect.y + (this.dragTransform.yScale - 1) * (event.clientY - helperRect.y) / this.dragTransform.yScale + 'px';
        helper.style.transformOrigin = `0px 0px`
      }

      let { top, left } = helper.getBoundingClientRect();
      const rect = this.el.getBoundingClientRect();
      left -= rect.left;
      top -= rect.top;
      const ui: DDUIData = {
        position: {
          top: top * this.dragTransform.xScale,
          left: left * this.dragTransform.yScale
        }
      };

      if (node._temporaryRemoved) {
        node.x = Math.max(0, Math.round(left / cellWidth));
        node.y = Math.max(0, Math.round(top / cellHeight));
        delete node.autoPosition;
        this.engine.nodeBoundFix(node);

        // don't accept *initial* location if doesn't fit #1419 (locked drop region, or can't grow), but maybe try if it will go somewhere
        if (!this.engine.willItFit(node)) {
          node.autoPosition = true; // ignore x,y and try for any slot...
          if (!this.engine.willItFit(node)) {
            dd.off(el, 'drag'); // stop calling us
            return; // full grid or can't grow
          }
          if (node._willFitPos) {
            // use the auto position instead #1687
            Utils.copyPos(node, node._willFitPos);
            delete node._willFitPos;
          }
        }

        // re-use the existing node dragging method
        this._onStartMoving(helper, event, ui, node, cellWidth, cellHeight);
      } else {
        // re-use the existing node dragging that does so much of the collision detection
        this._dragOrResize(helper, event, ui, node, cellWidth, cellHeight);
      }
    }

    dd.droppable(this.el, {
      accept: (el: GridItemHTMLElement) => {
        const node: GridStackNode = el.gridstackNode || this._readAttr(el, false);
        // set accept drop to true on ourself (which we ignore) so we don't get "can't drop" icon in HTML5 mode while moving
        if (node?.grid === this) return true;
        if (!this.opts.acceptWidgets) return false;
        // check for accept method or class matching
        let canAccept = true;
        if (typeof this.opts.acceptWidgets === 'function') {
          canAccept = this.opts.acceptWidgets(el);
        } else {
          const selector = (this.opts.acceptWidgets === true ? '.grid-stack-item' : this.opts.acceptWidgets as string);
          canAccept = el.matches(selector);
        }
        // finally check to make sure we actually have space left #1571 #2633
        if (canAccept && node && this.opts.maxRow) {
          const n = { w: node.w, h: node.h, minW: node.minW, minH: node.minH }; // only width/height matters and autoPosition
          canAccept = this.engine.willItFit(n);
        }
        return canAccept;
      }
    })
      /**
       * entering our grid area
       */
      .on(this.el, 'dropover', (event: Event, el: GridItemHTMLElement, helper: GridItemHTMLElement) => {
        // console.log(`over ${this.el.gridstack.opts.id} ${count++}`); // TEST
        let node = helper?.gridstackNode || el.gridstackNode;
        // ignore drop enter on ourself (unless we temporarily removed) which happens on a simple drag of our item
        if (node?.grid === this && !node._temporaryRemoved) {
          // delete node._added; // reset this to track placeholder again in case we were over other grid #1484 (dropout doesn't always clear)
          return false; // prevent parent from receiving msg (which may be a grid as well)
        }

        // If sidebar item, restore the sidebar node size to ensure consistent behavior when dragging between grids
        if (node?._sidebarOrig) {
          node.w = node._sidebarOrig.w;
          node.h = node._sidebarOrig.h;
        }

        // fix #1578 when dragging fast, we may not get a leave on the previous grid so force one now
        if (node?.grid && node.grid !== this && !node._temporaryRemoved) {
          // console.log('dropover without leave'); // TEST
          const otherGrid = node.grid;
          otherGrid._leave(el, helper);
        }
        helper = helper || el;

        // cache cell dimensions (which don't change), position can animate if we removed an item in otherGrid that affects us...
        cellWidth = this.cellWidth();
        cellHeight = this.getCellHeight(true);

        // sidebar items: load any element attributes if we don't have a node on first enter from the sidebar
        if (!node) {
          const attr = helper.getAttribute('data-gs-widget') || helper.getAttribute('gridstacknode'); // TBD: temp support for old V11.0.0 attribute
          if (attr) {
            try {
              node = JSON.parse(attr);
            } catch (error) {
              console.error("Gridstack dropover: Bad JSON format: ", attr);
            }
            helper.removeAttribute('data-gs-widget');
            helper.removeAttribute('gridstacknode');
          }
          if (!node) node = this._readAttr(helper); // used to pass false for #2354, but now we clone top level node
          // On first grid enter from sidebar, set the initial sidebar item size properties for the node
          node._sidebarOrig = { w: node.w, h: node.h }
        }
        if (!node.grid) { // sidebar item
          if (!node.el) node = {...node}; // clone first time we're coming from sidebar (since 'clone' doesn't copy vars)
          node._isExternal = true;
          helper.gridstackNode = node;
        }

        // calculate the grid size based on element outer size
        const w = node.w || Math.round(helper.offsetWidth / cellWidth) || 1;
        const h = node.h || Math.round(helper.offsetHeight / cellHeight) || 1;

        // if the item came from another grid, make a copy and save the original info in case we go back there
        if (node.grid && node.grid !== this) {
          // copy the node original values (min/max/id/etc...) but override width/height/other flags which are this grid specific
          // console.log('dropover cloning node'); // TEST
          if (!el._gridstackNodeOrig) el._gridstackNodeOrig = node; // shouldn't have multiple nested!
          el.gridstackNode = node = { ...node, w, h, grid: this };
          delete node.x;
          delete node.y;
          this.engine.cleanupNode(node)
            .nodeBoundFix(node);
          // restore some internal fields we need after clearing them all
          node._initDD =
            node._isExternal =  // DOM needs to be re-parented on a drop
            node._temporaryRemoved = true; // so it can be inserted onDrag below
        } else {
          node.w = w;
          node.h = h;
          node._temporaryRemoved = true; // so we can insert it
        }

        // clear any marked for complete removal (Note: don't check _isAboutToRemove as that is cleared above - just do it)
        GridStack._itemRemoving(node.el, false);

        dd.on(el, 'drag', onDrag);
        // make sure this is called at least once when going fast #1578
        onDrag(event as DragEvent, el, helper);
        return false; // prevent parent from receiving msg (which may be a grid as well)
      })
      /**
       * Leaving our grid area...
       */
      .on(this.el, 'dropout', (event, el: GridItemHTMLElement, helper: GridItemHTMLElement) => {
        // console.log(`out ${this.el.gridstack.opts.id} ${count++}`); // TEST
        const node = helper?.gridstackNode || el.gridstackNode;
        if (!node) return false;
        // fix #1578 when dragging fast, we might get leave after other grid gets enter (which calls us to clean)
        // so skip this one if we're not the active grid really..
        if (!node.grid || node.grid === this) {
          this._leave(el, helper);
          // if we were created as temporary nested grid, go back to before state
          if (this._isTemp) {
            this.removeAsSubGrid(node);
          }
        }
        return false; // prevent parent from receiving msg (which may be grid as well)
      })
      /**
       * end - releasing the mouse
       */
      .on(this.el, 'drop', (event, el: GridItemHTMLElement, helper: GridItemHTMLElement) => {
        const node = helper?.gridstackNode || el.gridstackNode;
        // ignore drop on ourself from ourself that didn't come from the outside - dragend will handle the simple move instead
        if (node?.grid === this && !node._isExternal) return false;

        const wasAdded = !!this.placeholder.parentElement; // skip items not actually added to us because of constrains, but do cleanup #1419
        const wasSidebar = el !== helper;
        this.placeholder.remove();
        delete this.placeholder.gridstackNode;

        // disable animation when replacing a placeholder (already positioned) with actual content
        if (wasAdded && this.opts.animate) {
          this.setAnimation(false);
          this.setAnimation(true, true); // delay adding back
        }

        // notify previous grid of removal
        // console.log('drop delete _gridstackNodeOrig') // TEST
        const origNode = el._gridstackNodeOrig;
        delete el._gridstackNodeOrig;
        if (wasAdded && origNode?.grid && origNode.grid !== this) {
          const oGrid = origNode.grid;
          oGrid.engine.removeNodeFromLayoutCache(origNode);
          oGrid.engine.removedNodes.push(origNode);
          oGrid._triggerRemoveEvent()._triggerChangeEvent();
          // if it's an empty sub-grid that got auto-created, nuke it
          if (oGrid.parentGridNode && !oGrid.engine.nodes.length && oGrid.opts.subGridDynamic) {
            oGrid.removeAsSubGrid();
          }
        }

        if (!node) return false;

        // use existing placeholder node as it's already in our list with drop location
        if (wasAdded) {
          this.engine.cleanupNode(node); // removes all internal _xyz values
          node.grid = this;
        }
        delete node.grid?._isTemp;
        dd.off(el, 'drag');
        // if we made a copy insert that instead of the original (sidebar item)
        if (helper !== el) {
          helper.remove();
          el = helper;
        } else {
          el.remove(); // reduce flicker as we change depth here, and size further down
        }
        this._removeDD(el);
        if (!wasAdded) return false;
        const subGrid = node.subGrid?.el?.gridstack; // set when actual sub-grid present
        Utils.copyPos(node, this._readAttr(this.placeholder)); // placeholder values as moving VERY fast can throw things off #1578
        Utils.removePositioningStyles(el);

        // give the user a chance to alter the widget that will get inserted if new sidebar item
        if (wasSidebar && (node.content || node.subGridOpts || GridStack.addRemoveCB)) {
          delete node.el;
          el = this.addWidget(node);
        } else {
          this._prepareElement(el, true, node);
          this.el.appendChild(el);
          // resizeToContent is skipped in _prepareElement() until node is visible (clientHeight=0) so call it now
          this.resizeToContentCheck(false, node);
          if (subGrid) {
            subGrid.parentGridNode = node;
          }
          this._updateContainerHeight();
        }
        this.engine.addedNodes.push(node);
        this._triggerAddEvent();
        this._triggerChangeEvent();

        this.engine.endUpdate();
        if (this._gsEventHandler['dropped']) {
          this._gsEventHandler['dropped']({ ...event, type: 'dropped' }, origNode && origNode.grid ? origNode : undefined, node);
        }

        return false; // prevent parent from receiving msg (which may be grid as well)
      });
    return this;
  }

  /** @internal mark item for removal */
  private static _itemRemoving(el: GridItemHTMLElement, remove: boolean) {
    if (!el) return;
    const node = el ? el.gridstackNode : undefined;
    if (!node?.grid || el.classList.contains(node.grid.opts.removableOptions.decline)) return;
    remove ? node._isAboutToRemove = true : delete node._isAboutToRemove;
    remove ? el.classList.add('grid-stack-item-removing') : el.classList.remove('grid-stack-item-removing');
  }

  /** @internal called to setup a trash drop zone if the user specifies it */
  protected _setupRemoveDrop(): GridStack {
    if (typeof this.opts.removable !== 'string') return this;
    const trashEl = document.querySelector(this.opts.removable) as HTMLElement;
    if (!trashEl) return this;

    // only register ONE static drop-over/dropout callback for the 'trash', and it will
    // update the passed in item and parent grid because the '.trash' is a shared resource anyway,
    // and Native DD only has 1 event CB (having a list and technically a per grid removableOptions complicates things greatly)
    if (!this.opts.staticGrid && !dd.isDroppable(trashEl)) {
      dd.droppable(trashEl, this.opts.removableOptions)
        .on(trashEl, 'dropover', (event, el) => GridStack._itemRemoving(el, true))
        .on(trashEl, 'dropout', (event, el) => GridStack._itemRemoving(el, false));
    }
    return this;
  }

  /**
   * prepares the element for drag&drop - this is normally called by makeWidget() unless are are delay loading
   * @param el GridItemHTMLElement of the widget
   * @param [force=false]
   * */
  public prepareDragDrop(el: GridItemHTMLElement, force = false): GridStack {
    const node = el?.gridstackNode;
    if (!node) return;
    const noMove = node.noMove || this.opts.disableDrag;
    const noResize = node.noResize || this.opts.disableResize;

    // check for disabled grid first
    const disable = this.opts.staticGrid || (noMove && noResize);
    if (force || disable) {
      if (node._initDD) {
        this._removeDD(el); // nukes everything instead of just disable, will add some styles back next
        delete node._initDD;
      }
      if (disable) el.classList.add('ui-draggable-disabled', 'ui-resizable-disabled'); // add styles one might depend on #1435
      if (!force) return this;
    }

    if (!node._initDD) {
      // variables used/cashed between the 3 start/move/end methods, in addition to node passed above
      let cellWidth: number;
      let cellHeight: number;

      /** called when item starts moving/resizing */
      const onStartMoving = (event: Event, ui: DDUIData) => {
        // trigger any 'dragstart' / 'resizestart' manually
        this.triggerEvent(event, event.target as GridItemHTMLElement);
        cellWidth = this.cellWidth();
        cellHeight = this.getCellHeight(true); // force pixels for calculations

        this._onStartMoving(el, event, ui, node, cellWidth, cellHeight);
      }

      /** called when item is being dragged/resized */
      const dragOrResize = (event: MouseEvent, ui: DDUIData) => {
        this._dragOrResize(el, event, ui, node, cellWidth, cellHeight);
      }

      /** called when the item stops moving/resizing */
      const onEndMoving = (event: Event) => {
        this.placeholder.remove();
        delete this.placeholder.gridstackNode;
        delete node._moving;
        delete node._resizing;
        delete node._event;
        delete node._lastTried;
        const widthChanged = node.w !== node._orig.w;

        // if the item has moved to another grid, we're done here
        const target: GridItemHTMLElement = event.target as GridItemHTMLElement;
        if (!target.gridstackNode || target.gridstackNode.grid !== this) return;

        node.el = target;

        if (node._isAboutToRemove) {
          const grid = el.gridstackNode.grid;
          if (grid._gsEventHandler[event.type]) {
            grid._gsEventHandler[event.type](event, target);
          }
          grid.engine.nodes.push(node); // temp add it back so we can proper remove it next
          grid.removeWidget(el, true, true);
        } else {
          Utils.removePositioningStyles(target);
          if (node._temporaryRemoved) {
            // got removed - restore item back to before dragging position
            Utils.copyPos(node, node._orig);// @ts-ignore
            this._writePosAttr(target, node);
            this.engine.addNode(node);
          } else {
            // move to new placeholder location
            this._writePosAttr(target, node);
          }
          this.triggerEvent(event, target);
        }
        // @ts-ignore
        this._extraDragRow = 0;// @ts-ignore
        this._updateContainerHeight();// @ts-ignore
        this._triggerChangeEvent();

        this.engine.endUpdate();

        if (event.type === 'resizestop') {
          if (Number.isInteger(node.sizeToContent)) node.sizeToContent = node.h; // new soft limit
          this.resizeToContentCheck(widthChanged, node); // wait for width animation if changed
        }
      }

      dd.draggable(el, {
        start: onStartMoving,
        stop: onEndMoving,
        drag: dragOrResize
      }).resizable(el, {
        start: onStartMoving,
        stop: onEndMoving,
        resize: dragOrResize
      });
      node._initDD = true; // we've set DD support now
    }

    // finally fine tune move vs resize by disabling any part...
    dd.draggable(el, noMove ? 'disable' : 'enable')
      .resizable(el, noResize ? 'disable' : 'enable');

    return this;
  }

  /** @internal handles actual drag/resize start */
  protected _onStartMoving(el: GridItemHTMLElement, event: Event, ui: DDUIData, node: GridStackNode, cellWidth: number, cellHeight: number): void {
    this.engine.cleanNodes()
      .beginUpdate(node);
    // @ts-ignore
    this._writePosAttr(this.placeholder, node)
    this.el.appendChild(this.placeholder);
    this.placeholder.gridstackNode = node;
    // console.log('_onStartMoving placeholder') // TEST

    // if the element is inside a grid, it has already been scaled
    // we can use that as a scale reference
    if (node.grid?.el) {
      this.dragTransform = Utils.getValuesFromTransformedElement(el);
    }
    // if the element is being dragged from outside (not from any grid)
    // we use the grid as the transformation reference, since the helper is not subject to transformation
    else if (this.placeholder && this.placeholder.closest('.grid-stack')) {
      const gridEl = this.placeholder.closest('.grid-stack') as HTMLElement;
      this.dragTransform = Utils.getValuesFromTransformedElement(gridEl);
    }
    // Fallback
    else {
      this.dragTransform = {
        xScale: 1,
        xOffset: 0,
        yScale: 1,
        yOffset: 0,
      }
    }

    node.el = this.placeholder;
    node._lastUiPosition = ui.position;
    node._prevYPix = ui.position.top;
    node._moving = (event.type === 'dragstart'); // 'dropover' are not initially moving so they can go exactly where they enter (will push stuff out of the way)
    node._resizing = (event.type === 'resizestart');
    delete node._lastTried;

    if (event.type === 'dropover' && node._temporaryRemoved) {
      // console.log('engine.addNode x=' + node.x); // TEST
      this.engine.addNode(node); // will add, fix collisions, update attr and clear _temporaryRemoved
      node._moving = true; // AFTER, mark as moving object (wanted fix location before)
    }

    // set the min/max resize info taking into account the column count and position (so we don't resize outside the grid)
    this.engine.cacheRects(cellWidth, cellHeight, this.opts.marginTop as number, this.opts.marginRight as number, this.opts.marginBottom as number, this.opts.marginLeft as number);
    if (event.type === 'resizestart') {
      const colLeft = this.getColumn() - node.x;
      const rowLeft = (this.opts.maxRow || Number.MAX_SAFE_INTEGER) - node.y;
      dd.resizable(el, 'option', 'minWidth', cellWidth * Math.min(node.minW || 1, colLeft))
        .resizable(el, 'option', 'minHeight', cellHeight * Math.min(node.minH || 1, rowLeft))
        .resizable(el, 'option', 'maxWidth', cellWidth * Math.min(node.maxW || Number.MAX_SAFE_INTEGER, colLeft))
        .resizable(el, 'option', 'maxWidthMoveLeft', cellWidth * Math.min(node.maxW || Number.MAX_SAFE_INTEGER, node.x+node.w))
        .resizable(el, 'option', 'maxHeight', cellHeight * Math.min(node.maxH || Number.MAX_SAFE_INTEGER, rowLeft))
        .resizable(el, 'option', 'maxHeightMoveUp', cellHeight * Math.min(node.maxH || Number.MAX_SAFE_INTEGER, node.y+node.h));
    }
  }

  /** @internal handles actual drag/resize */
  protected _dragOrResize(el: GridItemHTMLElement, event: MouseEvent, ui: DDUIData, node: GridStackNode, cellWidth: number, cellHeight: number): void {
    const p = { ...node._orig }; // could be undefined (_isExternal) which is ok (drag only set x,y and w,h will default to node value)
    let resizing: boolean;
    let mLeft = this.opts.marginLeft as number,
      mRight = this.opts.marginRight as number,
      mTop = this.opts.marginTop as number,
      mBottom = this.opts.marginBottom as number;

    // if margins (which are used to pass mid point by) are large relative to cell height/width, reduce them down #1855
    const mHeight = Math.round(cellHeight * 0.1),
      mWidth = Math.round(cellWidth * 0.1);
    mLeft = Math.min(mLeft, mWidth);
    mRight = Math.min(mRight, mWidth);
    mTop = Math.min(mTop, mHeight);
    mBottom = Math.min(mBottom, mHeight);

    if (event.type === 'drag') {
      if (node._temporaryRemoved) return; // handled by dropover
      const distance = ui.position.top - node._prevYPix;
      node._prevYPix = ui.position.top;
      if (this.opts.draggable.scroll !== false) {
        Utils.updateScrollPosition(el, ui.position, distance);
      }

      // get new position taking into account the margin in the direction we are moving! (need to pass mid point by margin)
      const left = ui.position.left + (ui.position.left > node._lastUiPosition.left ? -mRight : mLeft);
      const top = ui.position.top + (ui.position.top > node._lastUiPosition.top ? -mBottom : mTop);
      p.x = Math.round(left / cellWidth);
      p.y = Math.round(top / cellHeight);

      // @ts-ignore// if we're at the bottom hitting something else, grow the grid so cursor doesn't leave when trying to place below others
      const prev = this._extraDragRow;
      if (this.engine.collide(node, p)) {
        const row = this.getRow();
        let extra = Math.max(0, (p.y + node.h) - row);
        if (this.opts.maxRow && row + extra > this.opts.maxRow) {
          extra = Math.max(0, this.opts.maxRow - row);
        }// @ts-ignore
        this._extraDragRow = extra;// @ts-ignore
      } else this._extraDragRow = 0;// @ts-ignore
      if (this._extraDragRow !== prev) this._updateContainerHeight();

      if (node.x === p.x && node.y === p.y) return; // skip same
      // DON'T skip one we tried as we might have failed because of coverage <50% before
      // if (node._lastTried && node._lastTried.x === x && node._lastTried.y === y) return;
    } else if (event.type === 'resize') {
      if (p.x < 0) return;
      // Scrolling page if needed
      Utils.updateScrollResize(event, el, cellHeight);

      // get new size
      p.w = Math.round((ui.size.width - mLeft) / cellWidth);
      p.h = Math.round((ui.size.height - mTop) / cellHeight);
      if (node.w === p.w && node.h === p.h) return;
      if (node._lastTried && node._lastTried.w === p.w && node._lastTried.h === p.h) return; // skip one we tried (but failed)

      // if we size on left/top side this might move us, so get possible new position as well
      const left = ui.position.left + mLeft;
      const top = ui.position.top + mTop;
      p.x = Math.round(left / cellWidth);
      p.y = Math.round(top / cellHeight);

      resizing = true;
    }

    node._event = event;
    node._lastTried = p; // set as last tried (will nuke if we go there)
    const rect: GridStackPosition = { // screen pix of the dragged box
      x: ui.position.left + mLeft,
      y: ui.position.top + mTop,
      w: (ui.size ? ui.size.width : node.w * cellWidth) - mLeft - mRight,
      h: (ui.size ? ui.size.height : node.h * cellHeight) - mTop - mBottom
    };
    if (this.engine.moveNodeCheck(node, { ...p, cellWidth, cellHeight, rect, resizing })) {
      node._lastUiPosition = ui.position;
      this.engine.cacheRects(cellWidth, cellHeight, mTop, mRight, mBottom, mLeft);
      delete node._skipDown;
      if (resizing && node.subGrid) node.subGrid.onResize();
      this._extraDragRow = 0;// @ts-ignore
      this._updateContainerHeight();

      const target = event.target as GridItemHTMLElement;// @ts-ignore
      // Do not write sidebar item attributes back to the original sidebar el
      if (!node._sidebarOrig) {
        this._writePosAttr(target, node);
      }
      this.triggerEvent(event, target);
    }
  }

  /** call given event callback on our main top-most grid (if we're nested) */
  protected triggerEvent(event: Event, target: GridItemHTMLElement) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let grid: GridStack = this;
    while (grid.parentGridNode) grid = grid.parentGridNode.grid;
    if (grid._gsEventHandler[event.type]) {
      grid._gsEventHandler[event.type](event, target);
    }
  }

  /** @internal called when item leaving our area by either cursor dropout event
   * or shape is outside our boundaries. remove it from us, and mark temporary if this was
   * our item to start with else restore prev node values from prev grid it came from.
   */
  protected _leave(el: GridItemHTMLElement, helper?: GridItemHTMLElement): void {
    helper = helper || el;
    const node = helper.gridstackNode;
    if (!node) return;

    // remove the scale of the helper on leave
    helper.style.transform = helper.style.transformOrigin = null;
    dd.off(el, 'drag'); // no need to track while being outside

    // this gets called when cursor leaves and shape is outside, so only do this once
    if (node._temporaryRemoved) return;
    node._temporaryRemoved = true;

    this.engine.removeNode(node); // remove placeholder as well, otherwise it's a sign node is not in our list, which is a bigger issue
    node.el = node._isExternal && helper ? helper : el; // point back to real item being dragged
    const sidebarOrig = node._sidebarOrig;
    if (node._isExternal) this.engine.cleanupNode(node);
    // Restore sidebar item initial size info to stay consistent when dragging between multiple grids
    node._sidebarOrig = sidebarOrig;

    if (this.opts.removable === true) { // boolean vs a class string
      // item leaving us and we are supposed to remove on leave (no need to drag onto trash) mark it so
      GridStack._itemRemoving(el, true);
    }

    // finally if item originally came from another grid, but left us, restore things back to prev info
    if (el._gridstackNodeOrig) {
      // console.log('leave delete _gridstackNodeOrig') // TEST
      el.gridstackNode = el._gridstackNodeOrig;
      delete el._gridstackNodeOrig;
    } else if (node._isExternal) {
      // item came from outside restore all nodes back to original
      this.engine.restoreInitial();
    }
  }

  // legacy method removed
  public commit(): GridStack { obsolete(this, this.batchUpdate(false), 'commit', 'batchUpdate', '5.2'); return this; }
}
