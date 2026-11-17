export function promisify<T = void>(
    func: (callback: (error?: Error, result?: T) => void) => void,
    thisArg?: unknown
) {
    return new Promise((resolve, reject) => {
        func.call(thisArg, (error, result) => {
            if (error) {
                return reject(error);
            }

            resolve(result);
        });
    });
}
