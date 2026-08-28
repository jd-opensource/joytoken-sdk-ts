/**
 * timeout returns middleware that bounds each tool call to the given number of
 * milliseconds. A non-positive duration disables the timeout.
 *
 * Unlike Go, JavaScript has no goroutine to cancel: the underlying tool keeps
 * running in the background after a timeout fires. The middleware only bounds
 * how long the agent waits for the result before surfacing a timeout error the
 * model can feed back on. A tool that supports cooperative cancellation should
 * read an AbortSignal from its own closure.
 */
export function timeout(ms) {
    return (name, next) => {
        if (ms <= 0)
            return next;
        return (input, execution) => {
            let timer;
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`tool ${JSON.stringify(name)} timed out after ${ms}ms`));
                }, ms);
            });
            return Promise.race([
                // Wrap next() so a synchronous throw is also converted to a rejection
                // that races against the timeout rather than escaping the race.
                Promise.resolve()
                    .then(() => next(input, execution))
                    .finally(() => clearTimeout(timer)),
                timeoutPromise,
            ]);
        };
    };
}
/**
 * audit returns middleware that reports each tool invocation and its outcome
 * through the provided callback. The callback must not block for long; it runs
 * inline after the tool executes (or throws).
 */
export function audit(log) {
    return (name, next) => {
        return async (input, execution) => {
            try {
                const value = await next(input, execution);
                log?.(name, input, undefined);
                return value;
            }
            catch (error) {
                log?.(name, input, error);
                throw error;
            }
        };
    };
}
//# sourceMappingURL=middleware.js.map