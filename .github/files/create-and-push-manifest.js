const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function retry(fn, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxAttempts) {
                throw error; // Final attempt failed, crash the step
            }
            core.warning(`Attempt ${attempt} failed. Retrying in ${delayMs} ms... Error: ${error.message}`);
            await sleep(delayMs);
        }
    }
}
class RockImage {
    constructor(image, arch) {
        this.image = image
        this.arch = arch
    }

    async import_image() {
        console.info(`    ⏬ pull image: ${this.image}`)
        await retry(async () => await exec.exec("docker", ["pull", this.image]))
    }

    async remove_image() {
        console.info(`    ✂️ remove image: ${this.image}`)
        await exec.exec("docker", ["rmi", this.image])
    }

    async annotate(target) {
        console.info(`    🖌️ annotate manifest: ${target} ${this.arch}`)
        await exec.exec("docker", ["manifest", "annotate", target, this.image, `--arch=${this.arch}`])
    }
}

class RockComponent {
    constructor(name, version, dryRun) {
        this.name = name
        this.version = version
        this.dryRun = dryRun
        this.imageVer = `${this.name}:${this.version}`
        this.images = []
    }

    async create_manifest(target) {
        const archs = this.images.map(i => i.arch)
        const images = this.images.map(i => i.image)
        console.info(`  📄 create manifest: ${target} ${archs.join(",")}`)
        await exec.exec("docker", ["manifest", "create", target, ...images])
    }

    async push_manifest(target) {
        console.info(`  ⏫ push manifest: ${target}`)
        console.info(`docker manifest push ${target}`)
        if (this.dryRun != true) {
            await retry(async () => await exec.exec("docker", ["manifest", "push", target]))
        } else {
            console.info(`Not pushing manifest ${target} -- because dryRun: ${this.dryRun}`)
        }
    }

    async craft_manifest(target) {
        for (const image of this.images) {
            await image.import_image()
        }
        const targetImage = `${target.trim('/')}/${this.imageVer}`
        await exec.exec("docker", ["manifest", "rm", targetImage], { ignoreReturnCode: true })
        await this.create_manifest(targetImage)

        for (const image of this.images) {
            await image.annotate(targetImage)
        }
        await this.push_manifest(targetImage)
        for (const image of this.images) {
            await image.remove_image()
        }
    }
}

async function main(rockMetas, registry, dryRun) {
    const owner = context.repo.owner
    const metas = rockMetas
    const containers = {}
    for (const meta of metas) {
        let key = [meta.name, meta.version]
        if (!containers.hasOwnProperty(key)) {
            containers[key] = new RockComponent(meta.name, meta.version, dryRun)
        }
        containers[key].images.push(new RockImage(meta.image, meta.arch))
    }
    for (const component of Object.values(containers)) {
        console.info(`🖥️  Assemble Multiarch Image: ${component.name} version: ${component.version}`)
        await component.craft_manifest(`${registry}/${owner}`)
    }
}
