// dd-droppable.ts 3.1.3-dev @preserve

/**
 * https://gridstackjs.com/
 * (c) 2020 rhlin, Alain Dumesny
 * gridstack.js may be freely distributed under the MIT license.
*/
import { DDDraggable } from './dd-draggable';
import { DDManager } from './dd-manager';
import { DDBaseImplement, HTMLElementExtendOpt } from './dd-base-impl';
import { DDUtils } from './dd-utils';

export interface DDDroppableOpt {
  accept?: string | ((el: HTMLElement) => boolean) | undefined;
  drop?: (event: DragEvent, ui) => void;
  over?: (event: DragEvent, ui) => void;
  out?: (event: DragEvent, ui) => void;
}

export class DDDroppable extends DDBaseImplement implements HTMLElementExtendOpt<DDDroppableOpt> {

  public accept: (el: HTMLElement) => boolean;
  public el: HTMLElement;
  public option: DDDroppableOpt;

  /** @internal */
  private acceptable: boolean = null;

  constructor(el: HTMLElement, opts: DDDroppableOpt = {}) {
    super();
    this.el = el;
    this.option = opts;
    // create var event binding so we can easily remove and still look like TS methods (unlike anonymous functions)
    this._mouseEnter = this._mouseEnter.bind(this);
    this._dragOver = this._dragOver.bind(this);
    this._mouseLeave = this._mouseLeave.bind(this);
    this._drop = this._drop.bind(this);

    this.enable();
    this._setupAccept();
  }

  public on(event: 'drop' | 'dropover' | 'dropout', callback: (event: DragEvent) => void): void {
    super.on(event, callback);
  }

  public off(event: 'drop' | 'dropover' | 'dropout'): void {
    super.off(event);
  }

  public enable(): void {
    super.enable();
    this.el.classList.add('ui-droppable');
    this.el.classList.remove('ui-droppable-disabled');
    this.el.addEventListener('mouseenter', this._mouseEnter);
    this.el.addEventListener('mouseleave', this._mouseLeave);
  }

  public disable(): void {
    super.disable();
    this.el.classList.remove('ui-droppable');
    this.el.classList.add('ui-droppable-disabled');
    this.el.removeEventListener('mouseenter', this._mouseEnter);
    this.el.removeEventListener('mouseleave', this._mouseLeave);
  }

  public destroy(): void {
    this.disable();
    super.destroy();
  }

  public updateOption(opts: DDDroppableOpt): DDDroppable {
    Object.keys(opts).forEach(key => this.option[key] = opts[key]);
    this._setupAccept();
    return this;
  }

  /** @internal called when the cursor enters our area - prepare for a possible drop and track leaving */
  private _mouseEnter(event: MouseEvent): void {
    if (!DDManager.dragElement /* || DDManager.dropElement === this*/) return;
    this.acceptable = this._canDrop();
    if (this.acceptable) {
      event.preventDefault();
      DDManager.dropElement = this;
      const ev = DDUtils.initEvent<DragEvent>(event, { target: this.el, type: 'dropover' });
      if (this.option.over) {
        this.option.over(ev, this._ui(DDManager.dragElement))
      }
      this.triggerEvent('dropover', ev);
      this.el.classList.add('ui-droppable-over');
      /*
      this.el.addEventListener('dragover', this._dragOver);
      this.el.addEventListener('drop', this._drop);
      this.el.addEventListener('dragleave', this._mouseLeave);
      */
    }
  }

  /** @internal called when an acceptable to drop item is being dragged over - do nothing but eat the event */
  private _dragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  /** @internal called when the item is leaving our area, stop tracking if we had acceptable item */
  private _mouseLeave(event: DragEvent): void {
    if (!DDManager.dragElement || DDManager.dropElement !== this) return;
    /*
    if (this.el.contains(event.relatedTarget as HTMLElement)) return;
    this._removeLeaveCallbacks();
    if (this.acceptable) {
      event.preventDefault();
      const ev = DDUtils.initEvent<DragEvent>(event, { target: this.el, type: 'dropout' });
      if (this.option.out) {
        this.option.out(ev, this._ui(DDManager.dragElement))
      }
      this.triggerEvent('dropout', ev);
    }
    */
  }

  /** @internal item is being dropped on us - call the client drop event */
  private _drop(event: DragEvent): void {
    if (!this.acceptable) return; // should not have received event...
    event.preventDefault();
    const ev = DDUtils.initEvent<DragEvent>(event, { target: this.el, type: 'drop' });
    if (this.option.drop) {
      this.option.drop(ev, this._ui(DDManager.dragElement))
    }
    this.triggerEvent('drop', ev);
    this._removeLeaveCallbacks();
  }

  /** @internal called to remove callbacks when leaving or dropping */
  private _removeLeaveCallbacks() {
    this.el.removeEventListener('dragleave', this._mouseLeave);
    this.el.classList.remove('ui-droppable-over');
    if (this.acceptable) {
      this.el.removeEventListener('dragover', this._dragOver);
      this.el.removeEventListener('drop', this._drop);
    }
    this.el.addEventListener('mouseenter', this._mouseEnter);
  }

  /** @internal true if element matches the string/method accept option */
  private _canDrop(): boolean {
    return DDManager.dragElement && (!this.accept || this.accept(DDManager.dragElement.el));
  }

  /** @internal */
  private _setupAccept(): DDDroppable {
    if (!this.option.accept) return this;
    if (typeof this.option.accept === 'string') {
      this.accept = (el: HTMLElement) => el.matches(this.option.accept as string);
    } else {
      this.accept = this.option.accept;
    }
    return this;
  }

  /** @internal */
  private _ui(drag: DDDraggable) {
    return {
      draggable: drag.el,
      ...drag.ui()
    };
  }
}

