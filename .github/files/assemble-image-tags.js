async function get_by_assoc(assoc, package_name, type, method) {
    let containers
    try {
        core.info(`Looking up existing containers by ${type} ${assoc}/${package_name}`)
        containers = (await method({[type]: assoc, package_type: "container", package_name})).data;
    } catch (e) {
        containers = [];
        console.error(e);
    }
    return containers
}

async function get_containers(assoc, package_name) {
    let by_org = await get_by_assoc(assoc, package_name, "org", github.rest.packages.getAllPackageVersionsForPackageOwnedByOrg)
    let by_user = await get_by_assoc(assoc, package_name, "username", github.rest.packages.getAllPackageVersionsForPackageOwnedByUser)
    return by_org.concat(by_user)
}

async function main(rockMetas){
    const owner = context.repo.owner
    const metas = await Promise.all(
        rockMetas.map(
            async meta => {
                const versions = await get_containers(owner, meta.name)
                const rockVersion_ = meta.version + "-ck"
                const patchRev = versions.reduce((partial, v) =>
                    partial + v.metadata.container.tags.filter(t => t.startsWith(rockVersion_)).length, 0
                )
                meta.version = rockVersion_ + patchRev
                core.info(`Number of containers tagged ${owner}/${meta.name}/${meta.version}: ${patchRev}`)
                core.info(`Tagging image ${meta.image} with ${meta.version}`)
                return meta
            }
        ))
    core.setOutput('rock-metas', JSON.stringify(metas))
}