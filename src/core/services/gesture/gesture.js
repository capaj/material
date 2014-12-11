(function() {
'use strict';

var START_EVENTS = 'mousedown touchstart pointerdown';
var MOVE_EVENTS = 'mousemove touchmove pointermove';
var END_EVENTS = 'mouseup mouseleave touchend touchcancel pointerup pointercancel';
var HANDLERS;

document.addEventListener('click', function(ev) {
  // Prevent clicks unless they're sent by us.
  if (!ev.$material) {
    ev.preventDefault();
    ev.stopPropagation();
  }
}, true);

angular.element(document)
  .on(START_EVENTS, gestureStart)
  .on(MOVE_EVENTS, gestureMove)
  .on(END_EVENTS, gestureEnd)
  // For testing
  .on('$$mdGestureReset', function() {
    lastPointer = pointer = null;
  });

// The state of the current and previous 'pointer' (mouse/touch)
var pointer, lastPointer;

function runCallbacks(callbackType, event) {
  var handler;
  for (var handlerName in HANDLERS) {
    handler = HANDLERS[handlerName];
    if (callbackType === 'onStart') {
      handler.reset();
    }
    handler[callbackType](event, pointer);
  }
}

function gestureStart(ev) {
  // If we're already touched down, abort
  if (pointer) return;

  var now = +Date.now();
  // iOS & old android bug: after a touch event, a click event is sent 350 ms later.
  // If <400ms have passed, don't allow an event of a different type than the previous event
  if (lastPointer && !typesMatch(ev, lastPointer) && (now - lastPointer.endTime < 400)) {
    return;
  }

  pointer = makeStartPointer(ev);
  pointer.target = ev.target;

  runCallbacks('onStart', ev);
}

function gestureMove(ev) {
  if (!pointer || !typesMatch(ev, pointer)) return;

  updatePointerState(ev, pointer);
  runCallbacks('onMove', ev);
}

function gestureEnd(ev) {
  if (!pointer || !typesMatch(ev, pointer)) return;

  updatePointerState(ev, pointer);
  pointer.endTime = +Date.now();

  runCallbacks('onEnd', ev);

  lastPointer = pointer;
  pointer = null;
}

/******** Helpers *********/
function typesMatch(ev, pointer) {
  return ev && pointer && ev.type.charAt(0) === pointer.type;
}

function getEventPoint(ev) {
  ev = ev.originalEvent || ev; // support jQuery events
  return (ev.touches && ev.touches[0]) ||
    (ev.changedTouches && ev.changedTouches[0]) ||
    ev;
}

function updatePointerState(ev, pointer) {
  var point = getEventPoint(ev);
  var x = pointer.x = point.pageX;
  var y = pointer.y = point.pageY;

  pointer.distanceX = x - pointer.startX;
  pointer.distanceY = y - pointer.startY;
  pointer.distance = Math.sqrt(
    pointer.distanceX * pointer.distanceX + pointer.distanceY * pointer.distanceY
  );

  pointer.directionX = pointer.distanceX > 0 ? 'right' : pointer.distanceX < 0 ? 'left' : '';
  pointer.directionY = pointer.distanceY > 0 ? 'up' : pointer.distanceY < 0 ? 'down' : '';

  pointer.duration = +Date.now() - pointer.startTime;
  pointer.velocityX = pointer.distanceX / pointer.duration;
  pointer.velocityY = pointer.distanceY / pointer.duration;
}


function makeStartPointer(ev, data) {
  var point = getEventPoint(ev);
  var startPointer = angular.extend({
    // Restrict this tap to whatever started it: if a mousedown started the tap,
    // don't let anything but mouse events continue it.
    type: ev.type.charAt(0),
    startX: point.pageX,
    startY: point.pageY,
    startTime: +Date.now()
  }, data);
  startPointer.x = startPointer.startX;
  startPointer.y = startPointer.startY;
  return startPointer;
}

angular.module('material.core')
.run(function($mdGesture) {}) //make sure mdGesture runs always
.provider('$mdGesture', function() {
  HANDLERS = {};
  var provider;

  function dispatchEvent(type, data) {
    data = angular.extend({
      cancelable: true,
      bubbles: true,
      pointer: pointer,
      detail: {}
    }, data || {});
    var customEvent = new CustomEvent(type, data);
    customEvent.$material = true;
    customEvent.pointer = data.pointer;
    pointer.target.dispatchEvent(customEvent);
  }

  addHandler('click', function() {
    return {
      eventName: 'click',
      options: {
        maxDistance: 6,
      },
      onEnd: function(ev, pointer) {
        if (pointer.distance < this.options.maxDistance) {
          var mouseEvent = new MouseEvent('click', {
            clientX: pointer.x,
            clientY: pointer.y,
            screenX: pointer.x,
            screenY: pointer.y,
            bubbles: true,
            cancelable: true,
            view: window
          });
          mouseEvent.$material = true;
          mouseEvent.pointer = pointer;
          pointer.target.dispatchEvent(mouseEvent);
        }
      }
    };
  });

  addHandler('press', function() {
    return {
      onStart: function(ev, pointer) {
        dispatchEvent('$md.pressdown');
      },
      onEnd: function(ev, pointer) {
        dispatchEvent('$md.pressup');
      }
    };
  });

  // addHandler('hold', function($timeout) {
  //   var self;
  //   var holdPos;
  //   var holdTimeout;
  //   var holdTriggered;
  //   return self = {
  //     reset: function() {
  //       $timeout.cancel(holdTimeout);
  //       holdPos = holdTimeout = holdTriggered = null;
  //     },
  //     options: {
  //       delay: 500,
  //       maxDistance: 6,
  //     },
  //     onStart: resetTimeout,
  //     onMove: function(element, ev, pointer) {
  //       var dx = holdPos.x - pointer.x;
  //       var dy = holdPos.y - pointer.y;
  //       if (Math.sqrt(dx*dx + dy*dy) > self.options.maxDistance) {
  //         resetTimeout(element, ev, pointer);
  //       }
  //     },
  //     onEnd: function(element, ev, pointer) {
  //       $timeout.cancel(holdTimeout);
  //       holdTriggered = false;
  //       holdTimeout = null;
  //     }
  //   };
  //   function resetTimeout(element, ev, pointer) {
  //     if (holdTimeout) {
  //       $timeout.cancel(holdTimeout);
  //       holdTimeout = null;
  //     }
  //     if (!holdTriggered) {
  //       holdPos = {x: pointer.x, y: pointer.y};
  //       holdTimeout = $timeout(function() {
  //         element.triggerHandler('$md.hold', pointer);
  //         holdTriggered = true;
  //       }, self.options.delay);
  //     }
  //   }
  // });

  addHandler('drag', /* @ngInject */ function($$rAF) {
    var dragState;

    return {
      reset: function() {
        dragState = null;
      },
      options: {
        minDistance: 6,
      },
      onMove: function(ev, pointer) {
        ev.preventDefault(); //stop scrolling while dragging
        if (!dragState) {
          if (Math.abs(pointer.distanceX) > this.options.minDistance) {
            // Create a new pointer, starting at this point where the drag started.
            dragState = makeStartPointer(ev);
            updatePointerState(ev, dragState);
            dispatchEvent('$md.dragstart', { pointer: dragState });
          }
        } else {
          updatePointerState(ev, dragState);
          dispatchEvent('$md.drag', { pointer: dragState });
        }
      },
      onEnd: function(ev, pointer) {
        if (dragState) {
          updatePointerState(ev, dragState);
          dispatchEvent('$md.dragend', { pointer: dragState });
          dragState = null;
        }
      }
    };
  });

  addHandler('swipe', function() {
    return {
      options: {
        minVelocity: 0.65,
        minDistance: 10,
      },
      onEnd: function(ev, pointer) {
        if (Math.abs(pointer.velocityX) > this.options.minVelocity &&
            Math.abs(pointer.distanceX) > this.options.minDistance) {
          var eventType = pointer.directionX == 'left' ? '$md.swipeleft' : '$md.swiperight';
          dispatchEvent(eventType);
        }
      }
    };
  });

  return provider = {
    addHandler: addHandler,
    $get: GestureFactory
  };

  function addHandler(name, factory) {
    HANDLERS[name] = factory;
    return provider;
  }

  /* @ngInject */
  function GestureFactory($mdUtil, $rootScope, $document, $rootElement, $injector) {
    angular.forEach(HANDLERS, function(handler, handlerName) {
      HANDLERS[handlerName] = angular.extend({
        name: name,
        reset: angular.noop,
        onStart: angular.noop,
        onMove: angular.noop,
        onEnd: angular.noop,
        options: {}
      }, $injector.invoke( HANDLERS[handlerName] ));
    });
  }

});

})();
