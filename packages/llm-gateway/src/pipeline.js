// Pipeline — chain of transforms applied before/after LLM calls
export class Pipeline {
    transforms = [];
    use(transform) {
        this.transforms.push(transform);
        return this;
    }
    remove(name) {
        const idx = this.transforms.findIndex(t => t.name === name);
        if (idx === -1)
            return false;
        this.transforms.splice(idx, 1);
        return true;
    }
    async runBefore(messages, options) {
        let msgs = messages;
        let opts = options;
        for (const t of this.transforms) {
            if (t.before) {
                [msgs, opts] = await t.before(msgs, opts);
            }
        }
        return [msgs, opts];
    }
    async runAfter(result) {
        let res = result;
        for (const t of this.transforms) {
            if (t.after) {
                res = await t.after(res);
            }
        }
        return res;
    }
    list() {
        return [...this.transforms];
    }
}
//# sourceMappingURL=pipeline.js.map