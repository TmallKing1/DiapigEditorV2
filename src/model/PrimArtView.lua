-- PrimArtView：图元拟合图片（Diapig Editor「图元拟合」导出的数据模块）的通用绘制。
-- 只用官方 API，不依赖任何项目的上下文；imagePrefab 是图片控件（ClientUIImageControl）的模板索引。
-- 模块返回安装函数，导入阶段不创建控件。
return function(imagePrefab)
    local V = {}
    -- kind → {素材 ID, 图片模式}；软边在纹理中，不能给所有素材统一设 Stretch。
    local ASSETS = {
        { 100001, Enum.ImageType.Stretch },
        { 100002, Enum.ImageType.Stretch },
        { 100003, Enum.ImageType.Stretch },
        { 106057, Enum.ImageType.Basic },
        { 106093, Enum.ImageType.Stretch },
        { 106091, Enum.ImageType.Stretch },
    }

    local function integer(value)
        return type(value) == "number" and value % 1 == 0
    end

    local function validate(art)
        if type(art) ~= "table" or (art.format ~= 1 and art.format ~= 2 and art.format ~= 3) then return nil, "bad_format" end
        if not integer(art.w) or not integer(art.h) or art.w <= 0 or art.h <= 0 then return nil, "bad_size" end
        if not integer(art.bg) or art.bg < 0 or art.bg > 0xFFFFFF then return nil, "bad_bg" end
        if art.format == 3 or art.bgAlpha ~= nil then
            if not integer(art.bgAlpha) or art.bgAlpha < 0 or art.bgAlpha > 255 then return nil, "bad_bg_alpha" end
        end
        if type(art.shapes) ~= "table" then return nil, "bad_shapes" end
        local shapes, n = art.shapes, #art.shapes
        if n % 7 ~= 0 then return nil, "bad_stride" end
        -- 不接受稀疏数组、额外键或非整数，避免 # 的边界掩盖损坏记录。
        for key, value in pairs(shapes) do
            if not integer(key) or key < 1 or key > n or not integer(value) then return nil, "bad_shapes" end
        end
        for i = 1, n, 7 do
            for j = i, i + 6 do
                if not integer(shapes[j]) then return nil, "bad_record:" .. i end
            end
            local kind, color = shapes[i], shapes[i + 6]
            if not ASSETS[kind] or (art.format == 1 and kind > 3) then return nil, "bad_kind:" .. i end
            if shapes[i + 3] <= 0 or shapes[i + 4] <= 0 then return nil, "bad_shape_size:" .. i end
            local turn = (kind == 3 or kind == 5) and 360 or 180
            if shapes[i + 5] < 0 or shapes[i + 5] >= turn then return nil, "bad_rotation:" .. i end
            if color < 0x01000000 or color > 0xFFFFFFFF then return nil, "bad_color:" .. i end
        end
        return art
    end

    local function rgb(value, alpha)
        return Color((value >> 16) & 255, (value >> 8) & 255, value & 255, alpha)
    end

    local function newImage(parent, name, asset, color)
        local image = game.InstantiateClientUIControl(imagePrefab, parent)
        if not image then error("primart_create_failed:" .. name) end
        image:SetVisible(false)
        image.name = name
        image:SetActive(true)
        local assetId = asset[1]
        image:SetImage(Enum.ImageSource.StaticReference, assetId)
        if image.imageSource ~= Enum.ImageSource.StaticReference or image.imageId ~= assetId then
            error("primart_bind_failed:" .. name)
        end
        image.imageType = asset[2]
        image.imageColor = color
        image.enableMask = false
        image.enableSoftEdge = false
        image.reverseMaskArea = false
        image:SetFillUnused()
        image:SetPivot(0.5, 0.5)
        return image
    end

    --- 取出数据模块。moduleName 是 require 用的名字（放在子文件夹里时写 "子文件夹.模块名"）。
    --- 成功返回 art；模块缺失（没有脚本映射）或格式不对时返回 nil 和原因。
    function V.load(moduleName)
        local ok, art = pcall(require, moduleName)
        -- 不留在 require 缓存里：控件建完、调用方丢掉 art 后，原始表即可回收
        package.loaded[moduleName] = nil
        if not ok then return nil, "require_failed:" .. tostring(art) end
        return validate(art)
    end

    --- 分步绘制。先建好遮罩，之后每次 builder.step(budget) 最多再建 budget 个图元，全部建完返回 true。
    --- parent：父控件；x, y：遮罩中心相对父控件中心的偏移（父级局部坐标，Y 向上）；width：显示宽度，高度按比例；
    --- count：只画前 count 个图元（缺省为全部）。
    function V.begin(parent, name, art, x, y, width, count)
        local valid, why = validate(art)
        if not valid then error("primart_invalid:" .. why) end
        local k, shapes = width / art.w, art.shapes
        local total = math.min(count or math.huge, #shapes // 7)
        local maskAlpha = art.format == 3 and art.bgAlpha or 255
        local mask = newImage(parent, name, ASSETS[1], rgb(art.bg, maskAlpha))
        mask:SetAnchorMin(0.5, 0.5)
        mask:SetAnchorMax(0.5, 0.5)
        mask:SetSizeDelta(width, art.h * k)
        mask:SetAnchoredPosition(x, y)
        -- 正遮罩：只保留遮罩矩形内的子内容；自身 Alpha 为 0 时仍可裁切子图片
        mask.enableMask = true
        mask.reverseMaskArea = false
        mask:SetVisible(true)

        local builder = { mask = mask, parts = {}, total = total, done = total == 0 }

        function builder.step(budget)
            local parts = builder.parts
            local last = math.min(total, #parts + (budget or math.huge))
            for index = #parts + 1, last do
                local i = (index - 1) * 7 + 1
                local value = shapes[i + 6]
                local part = newImage(mask, name .. "_" .. index, ASSETS[shapes[i]], rgb(value, (value >> 24) & 255))
                -- 表中坐标以遮罩左下角为原点、Y 向上：锚点放在父级左下角，anchoredPosition 就是图元中心
                part:SetAnchorMin(0, 0)
                part:SetAnchorMax(0, 0)
                part:SetSizeDelta(shapes[i + 3] * k, shapes[i + 4] * k)
                part:SetAnchoredPosition(shapes[i + 1] * k, shapes[i + 2] * k)
                part:SetLocalRotation(0, 0, shapes[i + 5])
                part:SetVisible(true)
                parts[index] = part
            end
            builder.done = #parts >= total
            -- 建完后不再引用原始数据，让它可以被回收
            if builder.done then shapes = nil end
            return builder.done
        end

        --- 销毁全部控件（图元随遮罩一起销毁）；可重复调用。
        function builder.destroy()
            if builder.mask then game.DestroyClientUIControl(builder.mask) end
            builder.mask, builder.parts, builder.done, total, shapes = nil, {}, true, 0, nil
        end

        return builder
    end

    return V
end
