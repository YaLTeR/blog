"use strict";

let fpfLabel;
let fpfRange;
let expLabel;
let expRange;
let frames;

let gl;
let fpfLoc;
let exposureLoc;
let canRedraw = false;

window.addEventListener("DOMContentLoaded", setupRanges, false);

function setupRanges(evt) {
    window.removeEventListener(evt.type, setupRanges, false);

    fpfLabel = document.querySelector("#fpfLabel");
    fpfRange = document.querySelector("#fpf");
    expLabel = document.querySelector("#exposureLabel");
    expRange = document.querySelector("#exposure");
    frames = Array.from(document.querySelector("#frames").children);

    fpfRange.addEventListener("input", () => {
        updateUI();
    });

    expRange.addEventListener("input", () => {
        updateUI();
    });

    updateUI();
}

window.addEventListener("load", setupWebGL, false);

function setupWebGL(evt) {
    window.removeEventListener(evt.type, setupWebGL, false);

    const canvas = document.querySelector("#sampling");
    gl = canvas.getContext("webgl", {
        depth: false,
        stencil: false,
        antialias: false,
    });
    if (!gl) {
        console.error("WebGL is not supported");
        return;
    }

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    const image = new Image();
    image.onload = () => loadTexture(image);
    image.src = 'atlas.jpg';

    const vsSource = `
        attribute vec4 aVertexPos;

        void main() {
            gl_Position = aVertexPos;
        }
    `;

    const fsSource = `
        precision mediump float;

        uniform sampler2D uTexture;
        uniform int uFPF;
        uniform int uExposure;

        const vec2 SIZE = vec2(640, 360);
        const vec2 TILES = vec2(6, 10);

        vec2 ijImageCoord(vec2 normalized, vec2 ij) {
            return (normalized + ij) / TILES;
        }

        vec2 nthImageCoord(vec2 normalized, int n) {
            int y = n / 6;
            int x = n - y * 6;
            return ijImageCoord(normalized, vec2(x, y));
        }

        void main() {
            vec2 normalized = gl_FragCoord.xy / SIZE;
            normalized.y = 1. - normalized.y;

            int take_each = 60 / uFPF;

            gl_FragColor = vec4(0, 0, 0, 0);
            int n_frames = 0;
            for (int i = 0; i < 60; ++i) {
                if (i > 0 && i >= uExposure)
                    continue;

                if (i / take_each * take_each != i)
                    continue;

                vec2 pos = nthImageCoord(normalized, 59 - i);
                gl_FragColor += texture2D(uTexture, pos);
                n_frames += 1;
            }
            gl_FragColor /= float(n_frames);
        }
    `;

    const program = initShaderProgram(vsSource, fsSource);
    const vertexPosLoc = gl.getAttribLocation(program, "aVertexPos");
    const textureLoc = gl.getUniformLocation(program, "uTexture");
    fpfLoc = gl.getUniformLocation(program, "uFPF");
    exposureLoc = gl.getUniformLocation(program, "uExposure");
    gl.useProgram(program);

    const posBuffer = createBuffer([
         1,  1,
        -1,  1,
         1, -1,
        -1, -1,
    ]);
    gl.vertexAttribPointer(vertexPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexPosLoc);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(textureLoc, 0);
}

function loadShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(`Error compiling the shader: ${gl.getShaderInfoLog(shader)}`);
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

function initShaderProgram(vsSource, fsSource) {
    const vs = loadShader(gl.VERTEX_SHADER, vsSource);
    const fs = loadShader(gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(`Error linking the shader program: ${gl.getProgramInfoLog(program)}`);
        return null;
    }

    return program;
}

function createBuffer(data) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return buffer;
}

function loadTexture(image) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    canRedraw = true;
    updateUI();
}

function computeFPF(value) {
    if (value <= 1)
        return 1;
    if (value >= 60)
        return 60;

    const valid = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];

    for (let i = 0; i + 1 < valid.length; i++) {
        const curr = valid[i];
        const next = valid[i + 1];

        if (value > next)
            continue;

        if (value - curr < next - value)
            return curr;
        else
            return next;
    }
}

function computeExposure(value) {
    if (value <= 0)
        return 0;
    if (value >= 60)
        return 60;

    return Math.round(value);
}

function updateUI() {
    const fpf = computeFPF(fpfRange.value);
    const exposure = computeExposure(expRange.value);
    fpfLabel.textContent = `Samples per Second: ${fpf * 60}`;
    expLabel.textContent = `Exposure: ${(exposure / 60.).toFixed(1)}`;

    // Update CSS classes for individual frames.
    const take_each = 60 / fpf;
    for (let i = 0; i < 60; ++i) {
        if (i > 0 && i >= exposure) {
            frames[59 - i].className = "";
            continue;
        }

        if (i % take_each != 0) {
            frames[59 - i].className = "";
            continue;
        }
        
        frames[59 - i].className = "sampled";
    }

    redraw(fpf, exposure);
}

function redraw(fpf, exposure) {
    if (!canRedraw)
        return;

    gl.uniform1i(fpfLoc, fpf);
    gl.uniform1i(exposureLoc, exposure);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function setLowSPS() {
    fpfRange.value = 4;
    expRange.value = 60;
    updateUI();
}

function setHighSPS() {
    fpfRange.value = 60;
    expRange.value = 60;
    updateUI();
}

function setLowExposure() {
    fpfRange.value = 60;
    expRange.value = 5;
    updateUI();
}

function setHighExposure() {
    fpfRange.value = 60;
    expRange.value = 60;
    updateUI();
}

function setExposure(fraction) {
    fpfRange.value = 60;
    expRange.value = Math.round(fraction * 60);
    updateUI();
}
