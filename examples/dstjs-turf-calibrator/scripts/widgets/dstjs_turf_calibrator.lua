local Widget = require("widgets/widget")
local Text = require("widgets/text")
local TextButton = require("widgets/textbutton")
local TEMPLATES = require("widgets/redux/templates")

local RPC_NAMESPACE = "DSTJS_TURF_CALIBRATOR"
local CALIBRATION_CAMERA_DISTANCE = 22
local CALIBRATION_CAMERA_FOV = 35
local CALIBRATION_CAMERA_HEADING = 0
local COAST_CAMERA_DISTANCE = 34
local CAPTURE_SETTLE_SECONDS = 1.2
local CAPTURE_FRAME_DELAY_SECONDS = 0.25
local CAPTURE_WINDOW_SECONDS = 1.5
local COAST_CAMERA_PITCH = { 90, 35 }
local COAST_CASE_NAMES = {
    "straight",
    "diagonal",
    "outer_corner",
    "inner_bay",
    "peninsula",
    "island",
}

local function CreateCameraAnchor(x, y, z)
    local anchor = CreateEntity()
    anchor.entity:AddTransform()
    anchor.entity:SetCanSleep(false)
    anchor.persists = false
    anchor:AddTag("CLASSIFIED")
    anchor:AddTag("NOCLICK")
    anchor.Transform:SetPosition(x, y, z)
    return anchor
end

local function Send(action, value)
    SendModRPCToServer(GetModRPC(RPC_NAMESPACE, "command"), action, value or 0)
end

local function AddButton(parent, label, x, callback)
    local button = parent:AddChild(TextButton())
    button:SetFont(CHATFONT)
    button:SetTextSize(18)
    button:SetText(label)
    button:SetPosition(x, 0)
    button:SetOnClick(callback)
    return button
end

local TurfCalibrator = Class(Widget, function(self)
    Widget._ctor(self, "DST.js Turf Calibrator")
    self:SetScaleMode(SCALEMODE_PROPORTIONAL)
    self:SetHAnchor(ANCHOR_LEFT)
    self:SetVAnchor(ANCHOR_TOP)
    self:SetPosition(285, -82)

    self.mask = 0
    self.running = false
    self.player_hidden = false
    self.camera_state = nil
    self.camera_anchor = nil
    self.last_capture_mask = nil
    self.capture_task = nil
    self.capture_restore_task = nil
    self.capture_hud_was_visible = nil
    self.coast_running = false
    self.coast_case = 0
    self.coast_view = 0
    self.last_coast_capture = nil

    self.background = self:AddChild(TEMPLATES.RectangleWindow(690, 185))
    self.background:SetBackgroundTint(0.08, 0.06, 0.05, 0.82)
    self.background:MoveToBack()

    self.title = self:AddChild(Text(CHATFONT, 22, "DST.js Turf Calibrator"))
    self.title:SetPosition(0, 40)
    self.status = self:AddChild(Text(CHATFONT, 18, "mask = 000 / 255"))
    self.status:SetPosition(0, 14)

    AddButton(self, "Start", -154, function()
        self.mask = 0
        self.running = false
        self.last_capture_mask = nil
        self:CancelCaptureFrame()
        self:EnterCalibrationView()
        Send("start", self.mask)
        self:Refresh()
    end)
    AddButton(self, "Prev", -88, function()
        self.mask = (self.mask + 255) % 256
        self.running = false
        self:EnterCalibrationView()
        Send("set", self.mask)
        self:Refresh()
    end)
    AddButton(self, "Next", -22, function()
        self.mask = (self.mask + 1) % 256
        self.running = false
        self:EnterCalibrationView()
        Send("set", self.mask)
        self:Refresh()
    end)
    AddButton(self, "Auto", 47, function()
        self.running = true
        self.last_capture_mask = nil
        self:CancelCaptureFrame()
        self:EnterCalibrationView()
        Send("auto", self.mask)
        self:Refresh()
    end)
    AddButton(self, "Stop", 111, function()
        self.running = false
        self:CancelCaptureFrame()
        Send("stop")
        self:Refresh()
    end)
    AddButton(self, "Restore", 184, function()
        self.running = false
        self.last_capture_mask = nil
        self:CancelCaptureFrame()
        Send("restore")
        self:ExitCalibrationView()
        self:ShowPlayer()
        self:Refresh()
    end)

    self.hide_button = AddButton(self, "Hide player", -112, function()
        if self.player_hidden then
            self:ShowPlayer()
        elseif ThePlayer ~= nil then
            ThePlayer:Hide()
            self.player_hidden = true
            self:Refresh()
        end
    end)
    self.hide_button:SetPosition(-112, -42)

    self.coast_button = AddButton(self, "Coast Auto", 13, function()
        self.running = false
        self.coast_running = true
        self.last_coast_capture = nil
        self:CancelCaptureFrame()
        self:EnterCalibrationView()
        self:SetCalibrationPitch(COAST_CAMERA_PITCH[1])
        Send("coast_auto")
        self:Refresh()
    end)
    self.coast_button:SetPosition(13, -42)

    self.hint = self:AddChild(Text(CHATFONT, 15, "coast: 6 cases × top/angled · disposable world only"))
    self.hint:SetPosition(150, -42)
    self:StartUpdating()
end)

function TurfCalibrator:RestoreCaptureHud()
    if self.capture_hud_was_visible and ThePlayer ~= nil and ThePlayer.HUD ~= nil then
        ThePlayer.HUD:Show()
    end
    self.capture_hud_was_visible = nil
end

function TurfCalibrator:ScheduleCoastCapture(case_index, view_index)
    self:CancelCaptureFrame()
    local capture_key = string.format("%d:%d", case_index, view_index)
    self.last_coast_capture = capture_key
    if ThePlayer == nil or ThePlayer.HUD == nil then
        return
    end
    self:SetCalibrationPitch(COAST_CAMERA_PITCH[view_index + 1])
    self.capture_task = ThePlayer:DoTaskInTime(CAPTURE_SETTLE_SECONDS, function()
        self.capture_task = nil
        if not self.coast_running or ThePlayer == nil or ThePlayer.HUD == nil then
            return
        end
        self.capture_hud_was_visible = ThePlayer.HUD:IsVisible()
        ThePlayer.HUD:Hide()
        self.capture_task = ThePlayer:DoTaskInTime(CAPTURE_FRAME_DELAY_SECONDS, function()
            self.capture_task = nil
            if not self.coast_running then
                self:RestoreCaptureHud()
                return
            end
            local case_name = COAST_CASE_NAMES[case_index + 1] or "unknown"
            local view_name = view_index == 0 and "top" or "angled"
            print(string.format(
                "[DSTJS_COAST_CAPTURE] event=capture_ready case=%s case_index=%d view=%s pitch=%d distance=%.2f fov=%.2f heading=%.2f",
                case_name,
                case_index,
                view_name,
                COAST_CAMERA_PITCH[view_index + 1],
                COAST_CAMERA_DISTANCE,
                TheCamera.fov,
                TheCamera.heading
            ))
            self.capture_restore_task = ThePlayer:DoTaskInTime(CAPTURE_WINDOW_SECONDS, function()
                self.capture_restore_task = nil
                self:RestoreCaptureHud()
            end)
        end)
    end)
end

function TurfCalibrator:CancelCaptureFrame()
    if self.capture_task ~= nil then
        self.capture_task:Cancel()
        self.capture_task = nil
    end
    if self.capture_restore_task ~= nil then
        self.capture_restore_task:Cancel()
        self.capture_restore_task = nil
    end
    self:RestoreCaptureHud()
end

function TurfCalibrator:ScheduleCaptureFrame(mask)
    self:CancelCaptureFrame()
    self.last_capture_mask = mask
    if ThePlayer == nil or ThePlayer.HUD == nil then
        return
    end

    self.capture_task = ThePlayer:DoTaskInTime(CAPTURE_SETTLE_SECONDS, function()
        self.capture_task = nil
        if not self.running or self.mask ~= mask or ThePlayer == nil or ThePlayer.HUD == nil then
            return
        end
        self.capture_hud_was_visible = ThePlayer.HUD:IsVisible()
        ThePlayer.HUD:Hide()
        self.capture_task = ThePlayer:DoTaskInTime(CAPTURE_FRAME_DELAY_SECONDS, function()
            self.capture_task = nil
            if not self.running or self.mask ~= mask then
                self:RestoreCaptureHud()
                return
            end
            print(string.format(
                "[DSTJS_TURF_CAPTURE] event=capture_ready mask=%03d",
                mask
            ))
            self.capture_restore_task = ThePlayer:DoTaskInTime(CAPTURE_WINDOW_SECONDS, function()
                self.capture_restore_task = nil
                self:RestoreCaptureHud()
            end)
        end)
    end)
end

function TurfCalibrator:EnterCalibrationView()
    if self.camera_state ~= nil or TheCamera == nil or TheWorld == nil or ThePlayer == nil then
        return
    end

    local camera = TheCamera
    local offset_x, offset_y, offset_z = camera.targetoffset:Get()
    self.camera_state = {
        target = camera.target,
        target_offset = { offset_x, offset_y, offset_z },
        zoomstep = camera.zoomstep,
        mindist = camera.mindist,
        maxdist = camera.maxdist,
        mindistpitch = camera.mindistpitch,
        maxdistpitch = camera.maxdistpitch,
        distance = camera.distance,
        distancetarget = camera.distancetarget,
        fov = camera.fov,
        heading = camera.heading,
        headingtarget = camera.headingtarget,
        lockdistance = camera.lockdistance,
        controllable = camera.controllable,
        auto_hid_player = ThePlayer.entity:IsVisible(),
    }

    if self.camera_state.auto_hid_player then
        ThePlayer:Hide()
        if ThePlayer.DynamicShadow ~= nil then
            ThePlayer.DynamicShadow:Enable(false)
        end
        self.player_hidden = true
    end

    local player_x, player_y, player_z = ThePlayer.Transform:GetWorldPosition()
    local tile_x, tile_y = TheWorld.Map:GetTileCoordsAtPoint(player_x, player_y, player_z)
    local center_x, center_y, center_z = TheWorld.Map:GetTileCenterPoint(tile_x, tile_y)
    self.camera_anchor = CreateCameraAnchor(center_x, center_y, center_z)

    camera:LockDistance(false)
    camera:SetTarget(self.camera_anchor)
    camera:SetOffset(Vector3(0, 0, 0))
    camera:SetPitchRange(90, 90)
    camera:SetDistance(CALIBRATION_CAMERA_DISTANCE)
    camera:SetFOV(CALIBRATION_CAMERA_FOV)
    camera:SetHeadingTarget(CALIBRATION_CAMERA_HEADING)
    camera:SetControllable(false)
    camera:Snap()
    camera:LockDistance(true)
end

function TurfCalibrator:SetCalibrationPitch(pitch)
    if TheCamera == nil then
        return
    end
    TheCamera:LockDistance(false)
    TheCamera:SetPitchRange(pitch, pitch)
    TheCamera:SetDistance(COAST_CAMERA_DISTANCE)
    TheCamera:SetFOV(CALIBRATION_CAMERA_FOV)
    TheCamera:SetHeadingTarget(CALIBRATION_CAMERA_HEADING)
    TheCamera:Snap()
    TheCamera:LockDistance(true)
end

function TurfCalibrator:ExitCalibrationView()
    if self.camera_state == nil or TheCamera == nil then
        return
    end

    local camera = TheCamera
    local state = self.camera_state
    camera:LockDistance(false)
    camera.zoomstep = state.zoomstep
    camera:SetMinDistance(state.mindist)
    camera:SetMaxDistance(state.maxdist)
    camera:SetPitchRange(state.mindistpitch, state.maxdistpitch)
    camera:SetOffset(Vector3(
        state.target_offset[1],
        state.target_offset[2],
        state.target_offset[3]
    ))
    camera:SetDistance(state.distancetarget)
    camera:SetFOV(state.fov)
    camera:SetHeadingTarget(state.headingtarget)
    camera:SetControllable(state.controllable)

    if state.target ~= nil and state.target:IsValid() then
        camera:SetTarget(state.target)
    elseif ThePlayer ~= nil then
        camera:SetTarget(ThePlayer)
    end
    camera:Snap()
    camera.distance = state.distance
    camera.heading = state.heading
    camera:LockDistance(state.lockdistance)

    if state.auto_hid_player and ThePlayer ~= nil then
        ThePlayer:Show()
        if ThePlayer.DynamicShadow ~= nil then
            ThePlayer.DynamicShadow:Enable(true)
        end
        self.player_hidden = false
    end

    if self.camera_anchor ~= nil and self.camera_anchor:IsValid() then
        self.camera_anchor:Remove()
    end
    self.camera_anchor = nil
    self.camera_state = nil
end

function TurfCalibrator:OnUpdate()
    if TheWorld == nil then
        return
    end
    local was_running = self.running
    if TheWorld._dstjs_calibration_mask ~= nil then
        self.mask = TheWorld._dstjs_calibration_mask:value()
    end
    if TheWorld._dstjs_calibration_auto ~= nil then
        self.running = TheWorld._dstjs_calibration_auto:value()
    end
    if TheWorld._dstjs_coast_auto ~= nil then
        self.coast_running = TheWorld._dstjs_coast_auto:value()
    end
    if TheWorld._dstjs_coast_case ~= nil then
        self.coast_case = TheWorld._dstjs_coast_case:value()
    end
    if TheWorld._dstjs_coast_view ~= nil then
        self.coast_view = TheWorld._dstjs_coast_view:value()
    end
    if self.running and self.last_capture_mask ~= self.mask then
        self:ScheduleCaptureFrame(self.mask)
    elseif self.coast_running then
        local coast_key = string.format("%d:%d", self.coast_case, self.coast_view)
        if self.last_coast_capture ~= coast_key then
            self:ScheduleCoastCapture(self.coast_case, self.coast_view)
        end
    elseif was_running and not self.running then
        self:CancelCaptureFrame()
    end
    self:Refresh()
end

function TurfCalibrator:ShowPlayer()
    if self.player_hidden and ThePlayer ~= nil then
        ThePlayer:Show()
    end
    self.player_hidden = false
end

function TurfCalibrator:Refresh()
    local suffix = self.running and "  AUTO CAPTURE" or ""
    if self.coast_running then
        suffix = string.format(
            "  COAST %s / %s",
            COAST_CASE_NAMES[self.coast_case + 1] or "unknown",
            self.coast_view == 0 and "top" or "angled"
        )
    end
    suffix = self.camera_state ~= nil and suffix .. "  VIEW LOCKED" or suffix
    self.status:SetString(string.format("mask = %03d / 255%s", self.mask, suffix))
    self.hide_button:SetText(self.player_hidden and "Show player" or "Hide player")
end

function TurfCalibrator:OnControl(control, down)
    if TurfCalibrator._base.OnControl(self, control, down) then
        return true
    end
    return false
end

return TurfCalibrator
