import commander from './commander';
import masterCluster from './masterCluster';
import { logger, progress } from './utils';

const COMMAND_LIST = ['copy', 'move', 'del', 'zip', 'unzip', 'rename'];
const NAMESPACE_REGISTER_NAME = 'REGISTER_';
const PROGRESS_TASK_NAME = 'file manager';

const BUILTIN_EVENTS_MAP = {
  start: {
    hookType: 'tapAsync',
    hookName: 'beforeRun',
    registerName: NAMESPACE_REGISTER_NAME + 'beforeRun'
  },
  end: {
    hookType: 'tapAsync',
    hookName: 'afterEmit',
    registerName: NAMESPACE_REGISTER_NAME + 'afterEmit'
  }
};
const BUILTIN_EVENT_NAMES = Object.keys(BUILTIN_EVENTS_MAP);

class webpackPlugin {
  constructor(opts) {
    this.options = {};
    if (Object.prototype.toString.call(opts) === '[object Object]') {
      this.options = opts;
    }
    this.hookTypesMap = {
      tap: commands => this.tabCallback(commands),
      tapPromise: commands => this.tapPromiseCallback(commands),
      tapAsync: commands => this.tapAsyncCallback(commands)
    };
  }

  /**
   * @desc execute according command type
   * @param commands {Object}
   * @returns {Promise<void>}
   */
  async handleCommand(commands) {
    const { options: globalOptions = {} } = this.options;
    for (const command in commands) {
      if (commands.hasOwnProperty(command) && COMMAND_LIST.includes(command)) {
        let { items = [], options = {} } = commands[command];
        const opts = Object.assign({}, globalOptions, options);
        const { progress, parallel } = globalOptions;
        if (parallel) {
          const completedNum = await masterCluster(
            {
              jobs: items,
              cpu: parallel,
              type: command
            },
            opts
          );
          progress && this.progress.setSpeed(completedNum);
        } else {
          for (const item of items) {
            await commander[command](item, opts);
            progress && this.progress.setSpeed(1);
          }
        }
      }
    }
  }

  /**
   * @desc count total tasks
   * @returns {Number}
   * @param options
   */
  countTotalTasks(options) {
    let result = 0;
    for (const hookItem of options) {
      const { hookType, commands } = hookItem;
      if (!this.hookTypesMap[hookType]) continue;
      for (const command in commands) {
        if (
          commands.hasOwnProperty(command) &&
          COMMAND_LIST.includes(command)
        ) {
          let { items = [] } = commands[command];
          result += items.length;
        }
      }
    }

    return result;
  }

  /**
   * @description translate 'options' to other options with hooks and types of webpack
   * @returns {Array}
   * @example
   * [
   * {
   *   hookType: 'tapAsync', // reference to webpack compiler hook type
   *   hookName: 'afterEmit', // reference to webpack compiler hook name
   *   registerName: 'REGISTER_afterEmit',
   *   commands: {
   *     del: {
   *       items: [
   *          { source: './unzip/a.tar', destination: './dist/unzip/a', type: 'tar', options: {}},
   *       ],
   *       options: {
   *         before: () => {}
   *       }
   *     }
   *   }
   * }
   * ]
   */
  translateHooks() {
    const { events = {}, customHooks = [] } = this.options;
    let result = [];
    if (customHooks.length > 0) {
      result = customHooks.map(hook => {
        const { registerName, hookName } = hook;
        if (!registerName) {
          hook.registerName = NAMESPACE_REGISTER_NAME + hookName;
        }
        return hook;
      });
    } else {
      for (const event in events) {
        if (
          events.hasOwnProperty(event) &&
          BUILTIN_EVENT_NAMES.includes(event)
        ) {
          const commands = events[event];
          if (!commands) continue;
          const { hookType, hookName, registerName } = BUILTIN_EVENTS_MAP[
            event
          ];
          result.push({
            hookType,
            hookName,
            registerName,
            commands
          });
        }
      }
    }
    return result;
  }

  /**
   * @desc the type of tap hook callback
   * @param commands {Array}
   * @returns {Function}
   */
  tabCallback(commands) {
    return () => this.handleCommand(commands);
  }

  /**
   * the type of tapAsync hook callback
   * @param commands {Array}
   * @returns {Function}
   */
  tapAsyncCallback(commands) {
    return async (compilation, callback) => {
      await this.handleCommand(commands);
      callback();
    };
  }

  /**
   * the type of tapAsync hook callback
   * @param commands {Array}
   * @returns {Function}
   */
  tapPromiseCallback(commands) {
    return async () => {
      await this.handleCommand(commands);
    };
  }

  apply(compiler) {
    const { options: globalOptions = {} } = this.options;
    const options = this.translateHooks();
    const totalTasks = this.countTotalTasks(options);
    if (globalOptions.progress) {
      this.progress = progress({
        taskName: PROGRESS_TASK_NAME,
        start: 0,
        total: totalTasks
      });
    }
    for (const hookItem of options) {
      const { hookType, hookName, commands, registerName } = hookItem;
      if (!this.hookTypesMap[hookType]) continue;
      try {
        compiler.hooks[hookName][hookType](
          registerName,
          this.hookTypesMap[hookType](commands)
        );
      } catch (e) {
        logger.error(`File manager error: ${e}`);
      }
    }
  }
}

export default webpackPlugin;
