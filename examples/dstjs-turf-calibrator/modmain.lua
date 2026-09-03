local RPC_NAMESPACE = "DSTJS_TURF_CALIBRATOR"
local BACKGROUND_TILE_NAME = GetModConfigData("background_tile") or "DIRT"
local STEP_SECONDS = math.max(GetModConfigData("step_seconds") or 2, 2)
local MOVEMENT_LOCK_KEY = "dstjs_turf_calibrator"
local COAST_STEP_SECONDS = math.max(STEP_SECONDS, 5)

Assets = {
    Asset("IMAGE", "levels/tiles/dstjs_calibration.tex"),
    Asset("FILE", "levels/tiles/dstjs_calibration.xml"),
    Asset("IMAGE", "levels/textures/dstjs_calibration_noise.tex"),
}

modimport("scripts/register_tile.lua")

AddPrefabPostInit("world", function(world)
    world._dstjs_calibration_mask = GLOBAL.net_byte(
        world.GUID,
        "dstjs_turf_calibrator.mask",
        "dstjs_turf_calibrator_mask_dirty"
    )
    world._dstjs_calibration_active = GLOBAL.net_bool(
        world.GUID,
        "dstjs_turf_calibrator.active",
        "dstjs_turf_calibrator_active_dirty"
    )
    world._dstjs_calibration_auto = GLOBAL.net_bool(
        world.GUID,
        "dstjs_turf_calibrator.auto",
        "dstjs_turf_calibrator_auto_dirty"
    )
    world._dstjs_coast_case = GLOBAL.net_byte(
        world.GUID,
        "dstjs_turf_calibrator.coast_case",
        "dstjs_turf_coast_case_dirty"
    )
    world._dstjs_coast_view = GLOBAL.net_byte(
        world.GUID,
        "dstjs_turf_calibrator.coast_view",
        "dstjs_turf_coast_view_dirty"
    )
    world._dstjs_coast_auto = GLOBAL.net_bool(
        world.GUID,
        "dstjs_turf_calibrator.coast_auto",
        "dstjs_turf_coast_auto_dirty"
    )
end)

local NEIGHBOURS = {
    { 0, 1, "N" },
    { 1, 1, "NE" },
    { 1, 0, "E" },
    { 1, -1, "SE" },
    { 0, -1, "S" },
    { -1, -1, "SW" },
    { -1, 0, "W" },
    { -1, 1, "NW" },
}

local session = nil
local COAST_RADIUS = 8
local COAST_CASES = {
    {
        name = "straight",
        land = function(x, y) return y >= 0 end,
    },
    {
        name = "diagonal",
        land = function(x, y) return x + y >= 0 end,
    },
    {
        name = "outer_corner",
        land = function(x, y) return x >= 0 and y >= 0 end,
    },
    {
        name = "inner_bay",
        land = function(x, y) return y >= 0 or (math.abs(x) >= 3 and y >= -3) end,
    },
    {
        name = "peninsula",
        land = function(x, y) return y >= 2 or (math.abs(x) <= 1 and y >= -3) end,
    },
    {
        name = "island",
        land = function(x, y) return x * x + y * y <= 10 end,
    },
}

local function FindMapWorld()
    local global_world = GLOBAL.rawget(GLOBAL, "TheWorld")
    if global_world ~= nil and global_world.Map ~= nil then
        return global_world
    end
    if TheWorld ~= nil and TheWorld.Map ~= nil then
        return TheWorld
    end
    for _, entity in pairs(GLOBAL.Ents or {}) do
        if entity ~= nil and entity.prefab == "world" and entity.Map ~= nil then
            return entity
        end
    end
    return nil
end

local function SetNetworkState(world, name, value)
    local variable = world ~= nil and world[name] or nil
    if variable ~= nil then
        variable:set(value)
    end
end

local function CancelAutomaticStep()
    if session ~= nil and session.task ~= nil then
        session.task:Cancel()
        session.task = nil
    end
end

local function SetTileAndRebuild(world, x, y, tile)
    local original_tile = world.Map:GetTile(x, y)
    if original_tile == tile then
        return
    end
    world.Map:SetTile(x, y, tile)
    world.Map:RebuildLayer(original_tile, x, y)
    world.Map:RebuildLayer(tile, x, y)
    if world.minimap ~= nil and world.minimap.MiniMap ~= nil then
        world.minimap.MiniMap:RebuildLayer(original_tile, x, y)
        world.minimap.MiniMap:RebuildLayer(tile, x, y)
    end
end

local function RestoreTiles()
    if session == nil then
        return
    end
    local world = session.world or FindMapWorld()
    if world == nil then
        print("[DSTJS_TURF_CALIBRATION] event=restore_failed reason=map_world_not_found")
        return
    end
    CancelAutomaticStep()
    for _, entry in ipairs(session.original_tiles) do
        SetTileAndRebuild(world, entry.x, entry.y, entry.tile)
    end
    local drowning_guard_restored = false
    if session.player ~= nil and session.player:IsValid() and session.player.components.drownable ~= nil then
        session.player.components.drownable.enabled = session.drownable_enabled
        drowning_guard_restored = true
    end
    if session.player ~= nil and session.player:IsValid() and session.player.components.locomotor ~= nil then
        session.player.components.locomotor:RemoveExternalSpeedMultiplier(
            session.player,
            MOVEMENT_LOCK_KEY
        )
    end
    print(string.format(
        "[DSTJS_TURF_CALIBRATION] event=restore center=%d,%d",
        session.center_x,
        session.center_y
    ))
    SetNetworkState(world, "_dstjs_calibration_active", false)
    SetNetworkState(world, "_dstjs_calibration_auto", false)
    SetNetworkState(world, "_dstjs_coast_auto", false)
    print(string.format(
        "[DSTJS_COAST_CALIBRATION] event=drowning_guard enabled=false restored=%s",
        tostring(drowning_guard_restored)
    ))
    session = nil
end

local function BeginSession(player, radius)
    RestoreTiles()
    local world = FindMapWorld()
    if world == nil then
        return false
    end
    local world_x, world_y, world_z = player.Transform:GetWorldPosition()
    local center_x, center_y = world.Map:GetTileCoordsAtPoint(world_x, world_y, world_z)
    local original_tiles = {}
    radius = radius or 1
    for offset_y = -radius, radius do
        for offset_x = -radius, radius do
            table.insert(original_tiles, {
                x = center_x + offset_x,
                y = center_y + offset_y,
                tile = world.Map:GetTile(center_x + offset_x, center_y + offset_y),
            })
        end
    end
    session = {
        center_x = center_x,
        center_y = center_y,
        world = world,
        player = player,
        drownable_enabled = player.components.drownable ~= nil
            and player.components.drownable.enabled
            or nil,
        original_tiles = original_tiles,
        mask = 0,
        task = nil,
        radius = radius,
    }
    if player.components.drownable ~= nil then
        player.components.drownable.enabled = false
    end
    if player.components.locomotor ~= nil then
        player.components.locomotor:Stop()
        player.components.locomotor:SetExternalSpeedMultiplier(player, MOVEMENT_LOCK_KEY, 0)
    end
    print(string.format(
        "[DSTJS_COAST_CALIBRATION] event=drowning_guard enabled=true previous=%s",
        tostring(session.drownable_enabled)
    ))
    return true
end

local function ApplyCoastFrame(case_index, view_index)
    if session == nil then
        return
    end
    local world = session.world or FindMapWorld()
    local coast_case = COAST_CASES[case_index + 1]
    if world == nil or coast_case == nil then
        print("[DSTJS_COAST_CALIBRATION] event=frame_failed reason=invalid_state")
        return
    end
    local land_tile = WORLD_TILES.GRASS
    local ocean_tile = WORLD_TILES.OCEAN_COASTAL
    local rows = {}
    for offset_y = -COAST_RADIUS, COAST_RADIUS do
        local row = {}
        for offset_x = -COAST_RADIUS, COAST_RADIUS do
            local is_land = coast_case.land(offset_x, offset_y)
            SetTileAndRebuild(
                world,
                session.center_x + offset_x,
                session.center_y + offset_y,
                is_land and land_tile or ocean_tile
            )
            table.insert(row, is_land and "L" or "O")
        end
        table.insert(rows, table.concat(row))
    end
    session.coast_case = case_index
    session.coast_view = view_index
    SetNetworkState(world, "_dstjs_coast_case", case_index)
    SetNetworkState(world, "_dstjs_coast_view", view_index)
    SetNetworkState(world, "_dstjs_calibration_active", true)
    print(string.format(
        "[DSTJS_COAST_CALIBRATION] event=frame case=%s case_index=%d view=%s center=%d,%d radius=%d layout=%s",
        coast_case.name,
        case_index,
        view_index == 0 and "top" or "angled",
        session.center_x,
        session.center_y,
        COAST_RADIUS,
        table.concat(rows, "/")
    ))
end

local function StartCoastAutomatic(player)
    if not BeginSession(player, COAST_RADIUS) then
        return
    end
    CancelAutomaticStep()
    session.coast_case = 0
    session.coast_view = 0
    ApplyCoastFrame(0, 0)
    SetNetworkState(session.world, "_dstjs_coast_auto", true)
    session.task = session.world:DoPeriodicTask(COAST_STEP_SECONDS, function()
        if session == nil then
            return
        end
        local next_view = session.coast_view + 1
        local next_case = session.coast_case
        if next_view > 1 then
            next_view = 0
            next_case = next_case + 1
        end
        if next_case >= #COAST_CASES then
            CancelAutomaticStep()
            SetNetworkState(session.world, "_dstjs_coast_auto", false)
            print(string.format("[DSTJS_COAST_CALIBRATION] event=complete cases=%d views=2", #COAST_CASES))
            session.world:DoTaskInTime(2, RestoreTiles)
            return
        end
        ApplyCoastFrame(next_case, next_view)
    end)
end

local function BitIsSet(value, bit)
    return math.floor(value / (2 ^ bit)) % 2 == 1
end

local function Bits(value)
    local result = {}
    for bit = 0, 7 do
        table.insert(result, BitIsSet(value, bit) and "1" or "0")
    end
    return table.concat(result)
end

local function ApplyMask(mask)
    if session == nil then
        return
    end
    local world = session.world or FindMapWorld()
    if world == nil then
        print("[DSTJS_TURF_CALIBRATION] event=mask_failed reason=map_world_not_found")
        return
    end
    mask = math.max(0, math.min(255, math.floor(GLOBAL.tonumber(mask) or 0)))
    local calibration_tile = WORLD_TILES.DSTJS_CALIBRATION
    local background_tile = WORLD_TILES[BACKGROUND_TILE_NAME] or WORLD_TILES.DIRT
    -- The centre stays on the lower-priority background. Its single rendered
    -- calibration sprite is therefore the native NINE_SAMPLE result for the
    -- eight surrounding calibration tiles.
    world.Map:SetTile(session.center_x, session.center_y, background_tile)
    for bit, neighbour in ipairs(NEIGHBOURS) do
        local tile = BitIsSet(mask, bit - 1) and calibration_tile or background_tile
        world.Map:SetTile(session.center_x + neighbour[1], session.center_y + neighbour[2], tile)
    end
    session.mask = mask
    SetNetworkState(world, "_dstjs_calibration_mask", mask)
    SetNetworkState(world, "_dstjs_calibration_active", true)
    print(string.format(
        "[DSTJS_TURF_CALIBRATION] event=mask mask=%03d bits=%s center=%d,%d order=N,NE,E,SE,S,SW,W,NW protocol=center-background-v2",
        mask,
        Bits(mask),
        session.center_x,
        session.center_y
    ))
end

local function StartAutomaticStep(player, first_mask)
    if session == nil then
        if not BeginSession(player, 1) then
            return
        end
    end
    CancelAutomaticStep()
    ApplyMask(first_mask)
    SetNetworkState(session.world, "_dstjs_calibration_auto", true)
    session.task = session.world:DoPeriodicTask(STEP_SECONDS, function()
        if session == nil then
            return
        end
        if session.mask >= 255 then
            CancelAutomaticStep()
            SetNetworkState(session.world, "_dstjs_calibration_auto", false)
            print("[DSTJS_TURF_CALIBRATION] event=complete masks=256")
            return
        end
        ApplyMask(session.mask + 1)
    end)
end

AddModRPCHandler(RPC_NAMESPACE, "command", function(player, action, value)
    print(string.format(
        "[DSTJS_TURF_CALIBRATION] event=command action=%s value=%s user=%s",
        tostring(action),
        tostring(value),
        player ~= nil and tostring(player.userid) or "nil"
    ))
    local map_world = FindMapWorld()
    if player == nil or map_world == nil then
        local global_world = GLOBAL.rawget(GLOBAL, "TheWorld")
        print(string.format(
            "[DSTJS_TURF_CALIBRATION] event=command_rejected reason=map_world_not_found player=%s theworld=%s globalworld=%s ents=%s",
            tostring(player ~= nil),
            tostring(TheWorld),
            tostring(global_world),
            tostring(GLOBAL.Ents ~= nil)
        ))
        return
    end
    if action == "start" then
        if BeginSession(player, 1) then
            ApplyMask(value)
        end
    elseif action == "set" then
        if session == nil then
            if not BeginSession(player, 1) then
                return
            end
        end
        CancelAutomaticStep()
        ApplyMask(value)
    elseif action == "auto" then
        StartAutomaticStep(player, value)
    elseif action == "stop" then
        CancelAutomaticStep()
        SetNetworkState(session ~= nil and session.world or map_world, "_dstjs_calibration_auto", false)
        SetNetworkState(session ~= nil and session.world or map_world, "_dstjs_coast_auto", false)
        print("[DSTJS_TURF_CALIBRATION] event=stop")
    elseif action == "coast_auto" then
        StartCoastAutomatic(player)
    elseif action == "restore" then
        RestoreTiles()
    end
end)

AddClassPostConstruct("widgets/controls", function(controls)
    local TurfCalibrator = require("widgets/dstjs_turf_calibrator")
    controls.dstjs_turf_calibrator = controls.top_root:AddChild(TurfCalibrator())
    print("[DSTJS_TURF_CALIBRATION] event=hud_attached")
end)
