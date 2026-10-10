import process from "node:process";

interface DenoStdinRuntime {
    stdin: { readable: ReadableStream<Uint8Array> };
}

/** A cancellable input stream; Deno's Node stdin cannot cancel an outstanding read. */
export function readableStdin(): ReadableStream<Uint8Array> {
    if (process.versions.deno) {
        const runtime: DenoStdinRuntime = Reflect.get(globalThis, String("Deno"));
        return runtime.stdin.readable;
    }
    const input = process.stdin[Symbol.asyncIterator]();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const next = await input.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
        },
        async cancel() {
            // Release an in-flight next() before return() can settle.
            process.stdin.destroy();
            await input.return?.();
        },
    });
}
