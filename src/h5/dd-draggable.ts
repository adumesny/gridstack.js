// dd-draggable.ts 3.1.3-dev @preserve

/**
 * https://gridstackjs.com/
 * (c) 2021 Alain Dumesny, rhlin
 * gridstack.js may be freely distributed under the MIT license.
*/
import { DDManager } from './dd-manager';
import { DDUtils } from './dd-utils';
import { DDBaseImplement, HTMLElementExtendOpt } from './dd-base-impl';
import { GridItemHTMLElement, DDUIData } from '../types';
import { DDElementHost } from './dd-element';

// TODO: merge with DDDragOpt ?
export interface DDDraggableOpt {
  appendTo?: string | HTMLElement;
  containment?: string | HTMLElement; // TODO: not implemented yet
  handle?: string;
  revert?: string | boolean | unknown; // TODO: not implemented yet
  scroll?: boolean; // nature support by HTML5 drag drop, can't be switch to off actually
  helper?: string | HTMLElement | ((event: Event) => HTMLElement);
  basePosition?: 'fixed' | 'absolute';
  start?: (event: Event, ui: DDUIData) => void;
  stop?: (event: Event) => void;
  drag?: (event: Event, ui: DDUIData) => void;
}

interface DragOffset {
  left: number;
  top: number;
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export class DDDraggable extends DDBaseImplement implements HTMLElementExtendOpt<DDDraggableOpt> {
  public el: HTMLElement;
  public option: DDDraggableOpt;
  public helper: HTMLElement; // used by GridStackDDNative

  /** @internal */
  private mouseDownEvent: MouseEvent;
  /** @internal */
  private dragOffset: DragOffset;
  /** @internal */
  private dragElementOriginStyle: Array<string>;
  /** @internal */
  private moving = false;
  /** @internal */
  // private paintTimer: number;
  /** @internal */
  private parentOriginStylePosition: string;
  /** @internal */
  private helperContainment: HTMLElement;
  /** @internal */
  private static basePosition: 'fixed' | 'absolute' = 'absolute';
  /** @internal */
  private static originStyleProp = ['transition', 'pointerEvents', 'position', 'left', 'top'];

  constructor(el: HTMLElement, option: DDDraggableOpt = {}) {
    super();
    this.el = el;
    this.option = option;
    // create var event binding so we can easily remove and still look like TS methods (unlike anonymous functions)
    this._mouseDown = this._mouseDown.bind(this);
    this._mouseMove = this._mouseMove.bind(this);
    this._mouseUp = this._mouseUp.bind(this);
    this.enable();
  }

  public on(event: 'drag' | 'dragstart' | 'dragstop', callback: (event: DragEvent) => void): void {
    super.on(event, callback);
  }

  public off(event: 'drag' | 'dragstart' | 'dragstop'): void {
    super.off(event);
  }

  public enable(): void {
    super.enable();
    this.el.classList.remove('ui-draggable-disabled');
    this.el.classList.add('ui-draggable');
    this.el.addEventListener('mousedown', this._mouseDown);
  }

  public disable(forDestroy = false): void {
    super.disable();
    this.el.classList.remove('ui-draggable');
    if (!forDestroy) this.el.classList.add('ui-draggable-disabled');
    this.el.removeEventListener('mousedown', this._mouseDown);
  }

  public destroy(): void {
    if (this.moving) this._mouseUp(this.mouseDownEvent);
    this.disable(true);
    delete this.el;
    delete this.helper;
    delete this.option;
    super.destroy();
  }

  public updateOption(opts: DDDraggableOpt): DDDraggable {
    Object.keys(opts).forEach(key => this.option[key] = opts[key]);
    return this;
  }

  /** @internal call when mouse goes down before a dragstart happens */
  private _mouseDown(e: MouseEvent): void {
    // make sure we are clicking on a drag handle or child of it...
    let className = this.option.handle.substring(1);
    let el = e.target as HTMLElement;
    while (el && !el.classList.contains(className)) { el = el.parentElement; }
    if (!el) return;
    this.mouseDownEvent = e;
    document.addEventListener('mousemove', this._mouseMove, true); // capture, not bubble
    document.addEventListener('mouseup', this._mouseUp, true);
  }

  /** @internal */
  private _mouseMove(e: DragEvent): void {
    let s = this.mouseDownEvent;
    // don't start unless we've moved at least 3 pixels
    if (!this.moving && Math.abs(e.x - s.x) + Math.abs(e.y - s.y) > 2) {
      this.moving = true;
      DDManager.dragElement = this;
      // if we're dragging an actual grid item, set the current drop as the grid (to detect enter/leave)
      let el = (this.el as GridItemHTMLElement);
      if (el.gridstackNode && el.gridstackNode.grid) {
        DDManager.dropElement = (el.gridstackNode.grid.el as DDElementHost).ddElement.ddDroppable;
      } else {
        DDManager.dropElement = undefined;
      }
      this.helper = this._createHelper(e);
      this._setupHelperContainmentStyle();
      this.dragOffset = this._getDragOffset(e, this.el, this.helperContainment);
      const ev = DDUtils.initEvent<DragEvent>(e, { target: this.el, type: 'dragstart' });

      this._setupHelperStyle();
      this.helper.classList.add('ui-draggable-dragging');
      if (this.option.start) {
        this.option.start(ev, this.ui());
      }
      this.triggerEvent('dragstart', ev);
    } else if (this.moving) {
      this._dragFollow(e);
      const ev = DDUtils.initEvent<DragEvent>(e, { target: this.el, type: 'drag' });
      if (this.option.drag) {
        this.option.drag(ev, this.ui());
      }
      this.triggerEvent('drag', ev);
    }
  }

  /** @internal */
  private _mouseUp(e: MouseEvent): void {
    document.removeEventListener('mousemove', this._mouseMove, true);
    document.removeEventListener('mouseup', this._mouseUp, true);
    delete this.mouseDownEvent;
    delete DDManager.dragElement;
    delete DDManager.dropElement;
    if (this.moving) {
      delete this.moving;
      this.helper.classList.remove('ui-draggable-dragging');
      this.helperContainment.style.position = this.parentOriginStylePosition || null;
      if (this.helper === this.el) {
        this._removeHelperStyle();
      } else {
        this.helper.remove();
      }
      const ev = DDUtils.initEvent<DragEvent>(e, { target: this.el, type: 'dragstop' });
      if (this.option.stop) {
        this.option.stop(ev); // Note: ui() not used by gridstack so don't pass
      }
      this.triggerEvent('stop', ev);
    }
    delete this.helper;
  }

  /** @internal create a clone copy (or user defined method) of the original drag item if set */
  private _createHelper(event: DragEvent): HTMLElement {
    let helper = this.el;
    if (typeof this.option.helper === 'function') {
      helper = this.option.helper.apply(this.el, event);
    } else if (this.option.helper === 'clone') {
      helper = DDUtils.clone(this.el);
    }
    if (!document.body.contains(helper)) {
      DDUtils.appendTo(helper, this.option.appendTo === 'parent' ? this.el.parentNode : this.option.appendTo);
    }
    if (helper === this.el) {
      this.dragElementOriginStyle = DDDraggable.originStyleProp.map(prop => this.el.style[prop]);
    }
    return helper;
  }

  /** @internal */
  private _setupHelperStyle(): this {
    this.helper.style.pointerEvents = 'none';
    this.helper.style.transition = 'none'; // show up instantly
    this.helper.style.position = this.option.basePosition || DDDraggable.basePosition;
    return this;
  }

  /** @internal */
  private _removeHelperStyle(): this {
    // don't bother restoring styles if we're gonna remove anyway...
    let node = this.helper ? (this.helper as GridItemHTMLElement).gridstackNode : undefined;
    if (!node || !node._isAboutToRemove) {
      DDDraggable.originStyleProp.forEach(prop => {
        this.helper.style[prop] = this.dragElementOriginStyle[prop] || null;
      });
    }
    delete this.dragElementOriginStyle;
    return this;
  }

  /** @internal */
  private _dragFollow(event: DragEvent): void {
    /* if (this.paintTimer) {
      cancelAnimationFrame(this.paintTimer);
    }
    this.paintTimer = requestAnimationFrame(() => {
      delete this.paintTimer; */
    const offset = this.dragOffset;
    let containmentRect = { left: 0, top: 0 };
    if (this.helper.style.position === 'absolute') {
      const { left, top } = this.helperContainment.getBoundingClientRect();
      containmentRect = { left, top };
    }
    this.helper.style.left = event.clientX + offset.offsetLeft - containmentRect.left + 'px';
    this.helper.style.top = event.clientY + offset.offsetTop - containmentRect.top + 'px';
    // });
  }

  /** @internal */
  private _setupHelperContainmentStyle(): DDDraggable {
    this.helperContainment = this.helper.parentElement;
    if (this.option.basePosition !== 'fixed') {
      this.parentOriginStylePosition = this.helperContainment.style.position;
      if (window.getComputedStyle(this.helperContainment).position.match(/static/)) {
        this.helperContainment.style.position = 'relative';
      }
    }
    return this;
  }

  /** @internal */
  private _getDragOffset(event: DragEvent, el: HTMLElement, parent: HTMLElement): DragOffset {

    // in case ancestor has transform/perspective css properties that change the viewpoint
    let xformOffsetX = 0;
    let xformOffsetY = 0;
    if (parent) {
      const testEl = document.createElement('div');
      DDUtils.addElStyles(testEl, {
        opacity: '0',
        position: 'fixed',
        top: 0 + 'px',
        left: 0 + 'px',
        width: '1px',
        height: '1px',
        zIndex: '-999999',
      });
      parent.appendChild(testEl);
      const testElPosition = testEl.getBoundingClientRect();
      parent.removeChild(testEl);
      xformOffsetX = testElPosition.left;
      xformOffsetY = testElPosition.top;
      // TODO: scale ?
    }

    const targetOffset = el.getBoundingClientRect();
    return {
      left: targetOffset.left,
      top: targetOffset.top,
      offsetLeft: - event.clientX + targetOffset.left - xformOffsetX,
      offsetTop: - event.clientY + targetOffset.top - xformOffsetY,
      width: targetOffset.width,
      height: targetOffset.height
    };
  }

  /** @internal TODO: set to public as called by DDDroppable! */
  public ui = (): DDUIData => {
    const containmentEl = this.el.parentElement;
    const containmentRect = containmentEl.getBoundingClientRect();
    const offset = this.helper.getBoundingClientRect();
    return {
      position: { //Current CSS position of the helper as { top, left } object
        top: offset.top - containmentRect.top,
        left: offset.left - containmentRect.left
      }
      /* not used by GridStack for now...
      helper: [this.helper], //The object arr representing the helper that's being dragged.
      offset: { top: offset.top, left: offset.left } // Current offset position of the helper as { top, left } object.
      */
    };
  }
}