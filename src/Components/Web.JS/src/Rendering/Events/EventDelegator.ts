import { EventFieldInfo } from './EventFieldInfo';
import { dispatchEvent } from './EventDispatcher';
import { getBrowserEventName, getDotNetEventNames, getEventTypeOptions } from './EventTypes';

const nonBubblingBrowserEventNames = toLookup([
  'abort',
  'blur',
  'change',
  'error',
  'focus',
  'load',
  'loadend',
  'loadstart',
  'mouseenter',
  'mouseleave',
  'progress',
  'reset',
  'scroll',
  'submit',
  'unload',
  'toggle',
  'DOMNodeInsertedIntoDocument',
  'DOMNodeRemovedFromDocument',
]);

const alwaysPreventDefaultEvents: { [eventType: string]: boolean } = { submit: true };

const disableableBrowserEventNames = toLookup(['click', 'dblclick', 'mousedown', 'mousemove', 'mouseup']);

// Responsible for adding/removing the eventInfo on an expando property on DOM elements, and
// calling an EventInfoStore that deals with registering/unregistering the underlying delegated
// event listeners as required (and also maps actual events back to the given callback).
export class EventDelegator {
  private static nextEventDelegatorId = 0;

  private readonly eventsCollectionKey: string;

  private readonly afterClickCallbacks: ((event: MouseEvent) => void)[] = [];

  private eventInfoStore: EventInfoStore;

  constructor(private browserRendererId: number) {
    const eventDelegatorId = ++EventDelegator.nextEventDelegatorId;
    this.eventsCollectionKey = `_blazorEvents_${eventDelegatorId}`;
    this.eventInfoStore = new EventInfoStore(this.onGlobalEvent.bind(this));
  }

  public setListener(element: Element, dotNetEventName: string, eventHandlerId: number, renderingComponentId: number) {
    const infoForElement = this.getEventHandlerInfosForElement(element, true)!;
    const existingHandler = infoForElement.getHandler(dotNetEventName);

    if (existingHandler) {
      // We can cheaply update the info on the existing object and don't need any other housekeeping
      // Note that this also takes care of updating the eventHandlerId on the existing handler object
      this.eventInfoStore.update(existingHandler.eventHandlerId, eventHandlerId);
    } else {
      // Go through the whole flow which might involve registering a new global handler
      const newInfo = { element, dotNetEventName, eventHandlerId, renderingComponentId };
      this.eventInfoStore.add(newInfo);
      infoForElement.setHandler(dotNetEventName, newInfo);
    }
  }

  public getHandler(eventHandlerId: number) {
    return this.eventInfoStore.get(eventHandlerId);
  }

  public removeListener(eventHandlerId: number) {
    // This method gets called whenever the .NET-side code reports that a certain event handler
    // has been disposed. However we will already have disposed the info about that handler if
    // the eventHandlerId for the (element, dotNetEventName) pair was replaced during diff application.
    const info = this.eventInfoStore.remove(eventHandlerId);
    if (info) {
      // Looks like this event handler wasn't already disposed
      // Remove the associated data from the DOM element
      const element = info.element;
      const elementEventInfos = this.getEventHandlerInfosForElement(element, false);
      if (elementEventInfos) {
        elementEventInfos.removeHandler(info.dotNetEventName);
      }
    }
  }

  public notifyAfterClick(callback: (event: MouseEvent) => void) {
    // This is extremely special-case. It's needed so that navigation link click interception
    // can be sure to run *after* our synthetic bubbling process. If a need arises, we can
    // generalise this, but right now it's a purely internal detail.
    this.afterClickCallbacks.push(callback);
    this.eventInfoStore.addGlobalListener('click'); // Ensure we always listen for this
  }

  public setStopPropagation(element: Element, dotNetEventName: string, value: boolean) {
    const infoForElement = this.getEventHandlerInfosForElement(element, true)!;
    infoForElement.stopPropagation(dotNetEventName, value);
  }

  public setPreventDefault(element: Element, dotNetEventName: string, value: boolean) {
    const infoForElement = this.getEventHandlerInfosForElement(element, true)!;
    infoForElement.preventDefault(dotNetEventName, value);
  }

  private onGlobalEvent(evt: Event) {
    if (!(evt.target instanceof Element)) {
      return;
    }

    // Scan up the element hierarchy, looking for any matching registered event handlers
    let candidateElement = evt.target as Element | null;
    let eventArgsByDotNetEventName: { [dotNetEventName: string]: any } | null = null; // Populate lazily
    let dotNetEventNames: string[] | null = null; // Populate lazily
    const browserEventName = evt.type;
    const eventIsNonBubbling = nonBubblingBrowserEventNames.hasOwnProperty(browserEventName);
    let stopPropagationWasRequested = false;
    while (candidateElement) {
      const handlerInfos = this.getEventHandlerInfosForElement(candidateElement, false);
      if (handlerInfos) {
        if (dotNetEventNames === null) {
          dotNetEventNames = getDotNetEventNames(browserEventName);
        }

        dotNetEventNames.forEach(dotNetEventName => {
          const handlerInfo = handlerInfos.getHandler(dotNetEventName);
          if (handlerInfo && !eventIsDisabledOnElement(candidateElement!, browserEventName)) {
            // For certain built-in events, having any .NET handler implicitly means we will prevent
            // the browser's default behavior
            if (alwaysPreventDefaultEvents.hasOwnProperty(browserEventName)) {
              evt.preventDefault();
            }

            // We are going to raise an event for this element, so prepare info needed by the .NET code
            if (eventArgsByDotNetEventName === null) {
              eventArgsByDotNetEventName = {};
            }
            if (!eventArgsByDotNetEventName.hasOwnProperty(dotNetEventName)) {
              const eventOptions = getEventTypeOptions(dotNetEventName);
              const eventArgs = eventOptions.createEventArgs ? eventOptions.createEventArgs(evt) : {};
              eventArgsByDotNetEventName[dotNetEventName] = eventArgs;
            }

            dispatchEvent({
              browserRendererId: this.browserRendererId,
              eventHandlerId: handlerInfo.eventHandlerId,
              eventName: dotNetEventName,
              eventFieldInfo: EventFieldInfo.fromEvent(handlerInfo.renderingComponentId, evt)
            }, eventArgsByDotNetEventName[dotNetEventName]);
          }

          if (handlerInfos.stopPropagation(dotNetEventName)) {
            stopPropagationWasRequested = true;
          }

          if (handlerInfos.preventDefault(dotNetEventName)) {
            evt.preventDefault();
          }
        });
      }

      candidateElement = (eventIsNonBubbling || stopPropagationWasRequested) ? null : candidateElement.parentElement;
    }

    // Special case for navigation interception
    if (browserEventName === 'click') {
      this.afterClickCallbacks.forEach(callback => callback(evt as MouseEvent));
    }
  }

  private getEventHandlerInfosForElement(element: Element, createIfNeeded: boolean): EventHandlerInfosForElement | null {
    if (element.hasOwnProperty(this.eventsCollectionKey)) {
      return element[this.eventsCollectionKey];
    } else if (createIfNeeded) {
      return (element[this.eventsCollectionKey] = new EventHandlerInfosForElement());
    } else {
      return null;
    }
  }
}

// Responsible for adding and removing the global listener when the number of listeners
// for a given event name changes between zero and nonzero
class EventInfoStore {
  private infosByEventHandlerId: { [eventHandlerId: number]: EventHandlerInfo } = {};

  private countByEventName: { [eventName: string]: number } = {};

  constructor(private globalListener: EventListener) {
  }

  public add(info: EventHandlerInfo) {
    if (this.infosByEventHandlerId[info.eventHandlerId]) {
      // Should never happen, but we want to know if it does
      throw new Error(`Event ${info.eventHandlerId} is already tracked`);
    }

    this.infosByEventHandlerId[info.eventHandlerId] = info;

    this.addGlobalListener(info.dotNetEventName);
  }

  public get(eventHandlerId: number) {
    return this.infosByEventHandlerId[eventHandlerId];
  }

  public addGlobalListener(dotNetEventName: string) {
    if (this.countByEventName.hasOwnProperty(dotNetEventName)) {
      this.countByEventName[dotNetEventName]++;
    } else {
      this.countByEventName[dotNetEventName] = 1;

      // To make delegation work with non-bubbling events, register a 'capture' listener.
      // We preserve the non-bubbling behavior by only dispatching such events to the targeted element.
      const browserEventName = getBrowserEventName(dotNetEventName);
      const useCapture = nonBubblingBrowserEventNames.hasOwnProperty(browserEventName);
      document.addEventListener(browserEventName, this.globalListener, useCapture);
    }
  }

  public update(oldEventHandlerId: number, newEventHandlerId: number) {
    if (this.infosByEventHandlerId.hasOwnProperty(newEventHandlerId)) {
      // Should never happen, but we want to know if it does
      throw new Error(`Event ${newEventHandlerId} is already tracked`);
    }

    // Since we're just updating the event handler ID, there's no need to update the global counts
    const info = this.infosByEventHandlerId[oldEventHandlerId];
    delete this.infosByEventHandlerId[oldEventHandlerId];
    info.eventHandlerId = newEventHandlerId;
    this.infosByEventHandlerId[newEventHandlerId] = info;
  }

  public remove(eventHandlerId: number): EventHandlerInfo {
    const info = this.infosByEventHandlerId[eventHandlerId];
    if (info) {
      delete this.infosByEventHandlerId[eventHandlerId];

      const dotNetEventName = info.dotNetEventName;
      if (--this.countByEventName[dotNetEventName] === 0) {
        delete this.countByEventName[dotNetEventName];

        const browserEventName = getBrowserEventName(dotNetEventName);
        document.removeEventListener(browserEventName, this.globalListener);
      }
    }

    return info;
  }
}

class EventHandlerInfosForElement {
  // Although we *could* track multiple event handlers per (element, dotnetEventName) pair
  // (since they have distinct eventHandlerId values), there's no point doing so because
  // our programming model is that you declare event handlers as attributes. An element
  // can only have one attribute with a given name, hence only one event handler with
  // that name at any one time.
  // So to keep things simple, only track one EventHandlerInfo per (element, dotnetEventName)
  private handlers: { [dotNetEventName: string]: EventHandlerInfo } = {};
  private preventDefaultFlags: { [dotNetEventName: string]: boolean } | null = null;
  private stopPropagationFlags: { [dotNetEventName: string]: boolean } | null = null;

  public getHandler(dotNetEventName: string): EventHandlerInfo | null {
    return this.handlers.hasOwnProperty(dotNetEventName) ? this.handlers[dotNetEventName] : null;
  }

  public setHandler(dotNetEventName: string, handler: EventHandlerInfo) {
    this.handlers[dotNetEventName] = handler;
  }

  public removeHandler(dotNetEventName: string) {
    delete this.handlers[dotNetEventName];
  }

  public preventDefault(dotNetEventName: string, setValue?: boolean): boolean {
    if (setValue !== undefined) {
      this.preventDefaultFlags = this.preventDefaultFlags || {};
      this.preventDefaultFlags[dotNetEventName] = setValue;
    }

    return this.preventDefaultFlags ? this.preventDefaultFlags[dotNetEventName] : false;
  }

  public stopPropagation(dotNetEventName: string, setValue?: boolean): boolean {
    if (setValue !== undefined) {
      this.stopPropagationFlags = this.stopPropagationFlags || {};
      this.stopPropagationFlags[dotNetEventName] = setValue;
    }

    return this.stopPropagationFlags ? this.stopPropagationFlags[dotNetEventName] : false;
  }
}

interface EventHandlerInfo {
  element: Element;
  dotNetEventName: string;
  eventHandlerId: number;

  // The component whose tree includes the event handler attribute frame, *not* necessarily the
  // same component that will be re-rendered after the event is handled (since we re-render the
  // component that supplied the delegate, not the one that rendered the event handler frame)
  renderingComponentId: number;
}

function toLookup(items: string[]): { [key: string]: boolean } {
  const result = {};
  items.forEach(value => {
    result[value] = true;
  });
  return result;
}

function eventIsDisabledOnElement(element: Element, browserEventName: string): boolean {
  // We want to replicate the normal DOM event behavior that, for 'interactive' elements
  // with a 'disabled' attribute, certain mouse events are suppressed
  return (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)
    && disableableBrowserEventNames.hasOwnProperty(browserEventName)
    && element.disabled;
}
