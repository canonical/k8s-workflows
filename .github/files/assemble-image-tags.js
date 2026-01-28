async function get_by_assoc(assoc, package_name, type, method) {
    let containers
    try {
        core.info(`Looking up existing containers by ${type} ${assoc}/${package_name}`)
        containers = await github.paginate(method, {
            [type]: assoc,
            package_type: "container",
            package_name
        });
        core.info(`Found by ${assoc}`)
    } catch (e) {
        containers = [];
        console.error(e);
    }
    return containers;
}

async function get_containers(assoc, package_name) {
    let by_org = await get_by_assoc(assoc, package_name, "org", github.rest.packages.getAllPackageVersionsForPackageOwnedByOrg)
    if (by_org.length) return by_org;
    return await get_by_assoc(assoc, package_name, "username", github.rest.packages.getAllPackageVersionsForPackageOwnedByUser)
}

async function main(rockMetas){
    const owner = context.repo.owner
    const metas = await Promise.all(
        rockMetas.map(
            async meta => {
                const versions = await get_containers(owner, meta.name)
                const variant = meta.variant || ''
                const variantSuffix = variant ? `-${variant}` : ''
                const rockVersionBase = meta.version + "-ck"

                const patchRev = versions.reduce((partial, v) => {
                    return partial + v.metadata.container.tags.filter(t => {
                        if (variant) {
                            // Match pattern: version-ckN-variant (e.g., 1.2.3-ck0-static)
                            const pattern = new RegExp(`^${meta.version}-ck\\d+${variantSuffix}$`)
                            return pattern.test(t)
                        } else {
                            // Match pattern: version-ckN (e.g., 1.2.3-ck0)
                            const pattern = new RegExp(`^${meta.version}-ck\\d+$`)
                            return pattern.test(t)
                        }
                    }).length
                }, 0)

                core.info(`Number of containers tagged ${owner}/${meta.name}/${rockVersionBase}${variantSuffix}: ${patchRev}`)
                meta.version = rockVersionBase + patchRev + variantSuffix
                if (versions.some(v => v.metadata?.container?.tags?.includes(meta.version))) {
                    throw new Error(`Container ${owner}/${meta.name} is already tagged ${meta.version}`)
                }
                core.info(`Tagging image ${meta.image} with ${meta.version}`)
                return meta
            }
        ))
    core.setOutput('rock-metas', JSON.stringify(metas))
}
