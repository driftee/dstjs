name = "DST.js Turf Calibrator"
description = "Builds controlled turf and coastline patterns for recovering DST's native renderer behavior. Use only in a disposable test world."
author = "DST.js contributors"
version = "0.4.2"

dst_compatible = true
api_version = 10

client_only_mod = false
server_only_mod = false
all_clients_require_mod = true

icon_atlas = nil
icon = nil

configuration_options = {
    {
        name = "background_tile",
        label = "Background turf",
        hover = "Lower-priority vanilla turf used by the centre and neighbours whose bit is zero.",
        options = {
            { description = "Dirt", data = "DIRT" },
            { description = "Forest", data = "FOREST" },
            { description = "Savanna", data = "SAVANNA" },
        },
        default = "DIRT",
    },
    {
        name = "step_seconds",
        label = "Automatic step interval",
        hover = "Seconds between masks during automatic traversal.",
        options = {
            { description = "2 seconds", data = 2 },
            { description = "2.5 seconds", data = 2.5 },
            { description = "3 seconds", data = 3 },
        },
        default = 2,
    },
}
