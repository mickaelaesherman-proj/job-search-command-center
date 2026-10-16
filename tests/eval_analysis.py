import statistics as st
# role#: (AI overall, her rating, dims Scope,Skills,Level,Depth,Traj,Passion, her main reason)
D = {
 1:(4,3,(5,4,3,4,5,5),'Depth'), 2:(2,2,(4,3,1,4,4,3),'Skills'), 3:(3,2,(3,2,3,3,2,5),'Skills'),
 4:(4,3,(4,3,3,3,4,5),'Level'), 6:(4,1,(5,4,3,3,5,5),'Skills'), 7:(3,1,(4,2,2,3,4,2),'Skills'),
 8:(2,1,(5,3,1,5,5,4),'Level'), 9:(1,1,(1,1,2,1,1,3),'Skills'), 12:(4,1,(4,3,2,4,5,4),'Level'),
 13:(4,1,(5,4,3,4,4,5),'Skills'), 14:(2,1,(2,1,2,1,1,3),'Skills'), 15:(2,1,(4,2,2,1,5,5),'Skills'),
 16:(4,3,(5,3,3,2,4,4),'Level'), 17:(4,1,(4,3,3,2,4,5),'Depth'), 18:(4,3,(5,4,3,3,5,4),'Level'),
 20:(4,1,(5,3,2,5,4,3),'Level'), 22:(2,1,(1,1,1,4,1,3),'Skills'), 24:(2,1,(1,1,4,1,1,2),'Skills'),
 25:(4,1,(5,4,2,3,4,5),'Skills'),
 19:(3,1,(4,2,2,2,5,5),'Depth'), 23:(2,1,(3,1,2,1,3,3),'Depth')}
W=(.25,.20,.15,.10,.15,.15)
def v1(d):
    s=sum(w*x for w,x in zip(W,d)); o=round(s+1e-9)
    if d[2]==1 or d[3]==1: o=min(o,2)
    return o
# sanity: my recomputed v1 equals what I saved
bad=[k for k,(ai,h,d,r) in D.items() if v1(d)!=ai]
print('recomputed v1 matches saved AI score for all pairs:', not bad, bad)
def metrics(f,label):
    diffs=[f(d)-h for k,(ai,h,d,r) in D.items()]
    n=len(diffs); w1=sum(abs(x)<=1 for x in diffs); ex=sum(x==0 for x in diffs)
    print(f'{label:58s} exact {ex:2d}/{n}  within1 {w1:2d}/{n} ({100*w1//n}%)  MAE {st.mean(abs(x) for x in diffs):.2f}  bias {st.mean(diffs):+.2f}  big misses(>=2) {sum(abs(x)>=2 for x in diffs)}')
print('n rated pairs =',len(D))
metrics(v1,'v1 (as scored)')
print('\nAI too high / equal / too low:', sum(v1(d)>h for (ai,h,d,r) in D.values()), sum(v1(d)==h for (ai,h,d,r) in D.values()), sum(v1(d)<h for (ai,h,d,r) in D.values()))
print('her rating distribution:', {k:sum(h==k for (ai,h,d,r) in D.values()) for k in (1,2,3,4,5)})
print('her main reason (rated roles):', {r:sum(x[3]==r for x in D.values()) for r in ('Skills','Level','Depth')})
print('AI=4 roles: her ratings', sorted(h for (ai,h,d,r) in D.values() if ai==4), ' mean', round(st.mean(h for (ai,h,d,r) in D.values() if ai==4),2))
print('AI<=2 roles: her ratings', sorted(h for (ai,h,d,r) in D.values() if ai<=2), ' mean', round(st.mean(h for (ai,h,d,r) in D.values() if ai<=2),2))
# correlation
import math
a=[v1(d) for (ai,h,d,r) in D.values()]; b=[h for (ai,h,d,r) in D.values()]
ma,mb=st.mean(a),st.mean(b); cov=sum((x-ma)*(y-mb) for x,y in zip(a,b)); r=cov/math.sqrt(sum((x-ma)**2 for x in a)*sum((y-mb)**2 for y in b))
print('correlation AI vs you:', round(r,2))
print('\n--- What-if rubric changes, tested on THESE same 19 (so treat as hypotheses, not proof) ---')
def cap(d,o,cond,c): return min(o,c) if cond else o
def r1(d): o=v1(d); return min(o,2) if d[2]<=2 else o                          # Level 2 or below also caps at 2
def r2(d): o=r1(d); return min(o,2) if (d[1]<=3 and d[3]<=2) else o            # plus: middling skills + technical gap
W2=(.25,.25,.20,.10,.10,.10)                                                    # less weight on trajectory/passion, more on feasibility
def r3(d): s=sum(w*x for w,x in zip(W2,d)); o=round(s+1e-9); o=min(o,2) if d[2]<=1 or d[3]<=1 else o; return o
def r4(d): s=sum(w*x for w,x in zip(W2,d)); o=round(s+1e-9); o=min(o,2) if d[2]<=2 or d[3]<=1 else o; return o
def feas(d): return (d[1]+d[2]+d[3])/3
def des(d): return (d[0]+d[4]+d[5])/3
def r5(d): f=feas(d); o=round(min(f+0.5, 0.5*f+0.5*des(d))+1e-9); return max(1,min(5,o))   # feasibility is a gate: overall can't exceed feasibility+0.5
metrics(r1,'R1  Level<=2 also caps overall at 2')
metrics(r2,'R2  R1 + (Skills<=3 and Depth<=2) caps at 2')
metrics(r3,'R3  weights 25/25/20/10/10/10, caps at Level 1 or Depth 1')
metrics(r4,'R4  same weights, cap at Level<=2 or Depth 1')
metrics(r5,'R5  feasibility gate: overall <= feasibility+0.5')
print('\nper-role detail (AI v1 -> her; R4; R5):')
for k,(ai,h,d,r) in sorted(D.items()): print(f'  #{k:2d} AI {v1(d)} you {h}  diff {v1(d)-h:+d}   R4 {r4(d)}  R5 {r5(d)}   feasibility {feas(d):.1f} desirability {des(d):.1f}')
