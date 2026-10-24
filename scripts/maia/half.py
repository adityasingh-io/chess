"""fp16 storage, fp32 compute: every large float32 weight is stored as float16 and cast back on load.

argv: in.onnx out.onnx"""
import sys

import numpy as np
import onnx
from onnx import helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
casts, keep = [], []
for init in g.initializer:
    a = numpy_helper.to_array(init)
    if a.dtype == np.float32 and a.size >= 1024:
        half = numpy_helper.from_array(a.astype(np.float16), init.name + "_f16")
        keep.append(half)
        casts.append(helper.make_node("Cast", [half.name], [init.name], to=onnx.TensorProto.FLOAT, name=init.name + "_cast"))
    else:
        keep.append(init)
del g.initializer[:]
g.initializer.extend(keep)
nodes = list(g.node)
del g.node[:]
g.node.extend(casts + nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
