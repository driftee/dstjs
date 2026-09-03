if WORLD_TILES.DSTJS_CALIBRATION ~= nil then
    return
end

AddTile(
    "DSTJS_CALIBRATION",
    "LAND",
    { ground_name = "DST.js calibration" },
    {
        name = "dstjs_calibration",
        noise_texture = "dstjs_calibration_noise",
        runsound = "dontstarve/movement/run_dirt",
        walksound = "dontstarve/movement/walk_dirt",
        snowsound = "dontstarve/movement/run_snow",
        mudsound = "dontstarve/movement/run_mud",
        cannotbedug = true,
    }
)
