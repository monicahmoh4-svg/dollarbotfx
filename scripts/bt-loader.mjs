export async function resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
        try {
            return await next(specifier + '.ts', context);
        } catch (e) {
            /* fall through to default resolution */
        }
    }
    return next(specifier, context);
}
