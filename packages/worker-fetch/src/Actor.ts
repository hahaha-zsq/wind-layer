/* eslint-disable no-restricted-globals */

import { isWorker, isSafari, uid } from './util';
import { serialize, deserialize } from './webWorkerTransfer';
import ThrottledInvoker from './ThrottledInvoker';

/**
 * An implementation of the [Actor design pattern](http://en.wikipedia.org/wiki/Actor_model)
 * that maintains the relationship between asynchronous tasks and the objects
 * that spin them off - in this case, tasks like parsing parts of styles,
 * owned by the styles
 */
class Actor {
  target: any;
  parent: any;
  id: string;
  dispatcherId: number | undefined;
  callbacks: {
    number: any;
  };
  name: string;
  tasks: {
    [key: number]: any;
  };
  taskQueue: number[];
  cancelCallbacks: {
    number: Cancelable;
  };
  invoker: ThrottledInvoker;
  globalScope: any;

  constructor(target: any, parent: any, dispatcherId?: number) {
    this.target = target;
    this.parent = parent;
    this.id = uid('actor');
    this.dispatcherId = dispatcherId;
    this.callbacks = {} as { number: any };
    this.tasks = {} as { number: any };
    this.taskQueue = [];
    this.cancelCallbacks = {} as { number: Cancelable };
    this.receive = this.receive.bind(this);
    this.process = this.process.bind(this);
    this.invoker = new ThrottledInvoker(this.process);
    this.target.addEventListener('message', this.receive, false);
    this.globalScope = isWorker() ? target : window;
  }

  /**
   * Sends a message from a main-thread map to a Worker or from a Worker back to
   * a main-thread map instance.
   *
   * @param type The name of the target method to invoke or '[source-type].[source-name].name' for a method on a WorkerSource.
   * @param data
   * @param callback
   * @param targetId A particular mapId to which to send this message.
   * @param mustQueue
   * @private
   */
  send(type: string, data: unknown, callback?: () => void, targetId?: string | null, mustQueue = false): Cancelable {
    // We're using a string ID instead of numbers because they are being used as object keys
    // anyway, and thus stringified implicitly. We use random IDs because an actor may receive
    // message from multiple other actors which could run in different execution context. A
    // linearly increasing ID could produce collisions.
    const id = Math.round(Math.random() * 1e18)
      .toString(36)
      .substring(0, 10);
    if (callback) {
      this.callbacks[id] = callback;
    }
    const buffers: undefined | any[] = isSafari(this.globalScope) ? undefined : [];
    this.target.postMessage(
      {
        id,
        type,
        hasCallback: !!callback,
        targetId,
        mustQueue,
        dispatcherId: this.dispatcherId,
        data: serialize(data, buffers),
      },
      buffers,
    );
    return {
      cancel: () => {
        if (callback) {
          // Set the callback to null so that it never fires after the request is aborted.
          delete this.callbacks[id];
        }
        this.target.postMessage({
          id,
          type: '<cancel>',
          targetId,
          dispatcherId: this.dispatcherId,
        });
      },
    };
  }

  receive(message: any) {
    const { data } = message;
    const { id } = data;

    if (!id) {
      return;
    }

    if (data.targetId && this.dispatcherId !== data.targetId) {
      return;
    }

    if (data.type === '<cancel>') {
      // Remove the original request from the queue. This is only possible if it
      // hasn't been kicked off yet. The id will remain in the queue, but because
      // there is no associated task, it will be dropped once it's time to execute it.
      delete this.tasks[id];
      const cancel = this.cancelCallbacks[id];
      delete this.cancelCallbacks[id];
      if (cancel) {
        cancel();
      }
    } else if (isWorker() || data.mustQueue) {
      // In workers, store the tasks that we need to process before actually processing them. This
      // is necessary because we want to keep receiving messages, and in particular,
      // <cancel> messages. Some tasks may take a while in the worker thread, so before
      // executing the next task in our queue, postMessage preempts this and <cancel>
      // messages can be processed. We're using a MessageChannel object to get throttle the
      // process() flow to one at a time.
      this.tasks[id] = data;
      this.taskQueue.push(id);
      this.invoker.trigger();
    } else {
      // In the main thread, process messages immediately so that other work does not slip in
      // between getting partial data back from workers.
      this.processTask(id, data);
    }
  }

  process() {
    if (!this.taskQueue.length) {
      return;
    }
    const id = this.taskQueue.shift();
    if (id === undefined) return;
    const task = this.tasks[id];
    delete this.tasks[id];
    // Schedule another process call if we know there's more to process _before_ invoking the
    // current task. This is necessary so that processing continues even if the current task
    // doesn't execute successfully.
    if (this.taskQueue.length) {
      this.invoker.trigger();
    }
    if (!task) {
      // If the task ID doesn't have associated task data anymore, it was canceled.
      return;
    }

    this.processTask(id, task);
  }

  processTask(id: number, task: any) {
    if (task.type === '<response>') {
      // The done() function in the counterpart has been called, and we are now
      // firing the callback in the originating actor, if there is one.
      const callback = this.callbacks[id];
      delete this.callbacks[id];
      if (callback) {
        // If we get a response, but don't have a callback, the request was canceled.
        if (task.error) {
          callback(deserialize(task.error));
        } else {
          callback(null, deserialize(task.data));
        }
      }
    } else {
      let completed = false;
      const buffers: undefined | any[] = isSafari(this.globalScope) ? undefined : [];
      const done = task.hasCallback
        ? (err: Error, data?: any) => {
            completed = true;
            delete this.cancelCallbacks[id];
            this.target.postMessage(
              {
                id,
                type: '<response>',
                dispatcherId: this.dispatcherId,
                error: err ? serialize(err) : null,
                data: serialize(data, buffers),
              },
              buffers,
            );
          }
        : () => {
            completed = true;
          };

      let callback: WithNull<Cancelable> = null;
      const params = deserialize(task.data) as any;
      if (this.parent[task.type]) {
        callback = this.parent[task.type]?.(task.dispatcherId, params, done);
      } else {
        // No function was found.
        done(new Error(`Could not find function ${task.type}`));
      }

      if (!completed && callback && callback.cancel) {
        // Allows canceling the task as long as it hasn't been completed yet.
        this.cancelCallbacks[id] = callback.cancel;
      }
    }
  }

  remove() {
    this.invoker.remove();
    this.target.removeEventListener('message', this.receive, false);
  }
}

export default Actor;
