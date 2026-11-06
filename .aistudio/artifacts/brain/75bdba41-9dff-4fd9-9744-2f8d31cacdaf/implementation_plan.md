# Literal Verbatim Transcode: ChilliMark Python to TypeScript

This document reproduces the verbatim source code of the original Python functions from `https://github.com/razimasri/ChilliMark/blob/main/ChilliMark.py` and maps each statement directly into TypeScript.

---

## 1. Verbatim Source Functions & TypeScript Equivalents

### 1.1 `area(n)`
**Python Source (lines 831-833):**
```python
def area(n):
	_,_,w,h = cv2.boundingRect(n)
	return h*w
```
**TypeScript Mapping:**
Takes an OpenCV contour, computes `const r = cv.boundingRect(c);`, returns `r.width * r.height`.

---

### 1.2 `largest_cnt(image)`
**Python Source (lines 393-405):**
```python
def largest_cnt(image:cv2.typing.MatLike) -> cv2.typing.MatLike:
	"""Find the largest contour on the page for use with alignment functions. 
	Note that it draws a border on the image to eliminate false contours from scan edges."""

	gray = cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
	thresh = cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV| cv2.THRESH_OTSU)[1] 
	thresh = cv2.rectangle(thresh,(0,0),(thresh.shape[1],thresh.shape[0]),0,200)
	cnts,_ = cv2.findContours(thresh,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
	filtered = filter(lambda cnt: area(cnt)>4000000,cnts)
	sorted_cnts = sorted(filtered, key=area, reverse=True)
	largest = sorted_cnts[0]
	largest = cv2.approxPolyDP(largest, 0.01*cv2.arcLength(largest, True), True)
	return largest
```
**TypeScript Mapping:**
- Converts to grayscale: `cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY)`.
- Thresholds: `cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU)`.
- Draws border: `cv.rectangle(thresh, new cv.Point(0, 0), new cv.Point(thresh.cols, thresh.rows), new cv.Scalar(0, 0, 0, 0), 200)`.
- Finds contours: `cv.findContours(thresh, cnts, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)`.
- Filters contours with `area(cnt) > 4000000`, sorts descending by `area(cnt)`, selects `sorted_cnts[0]`.
- Approximates polynomial: `cv.approxPolyDP(largest, approx, 0.01 * cv.arcLength(largest, true), true)`.
- Returns `approx`.

---

### 1.3 `rotation(page)`
**Python Source (lines 407-424):**
```python
def rotation(page: cv2.typing.MatLike) -> cv2.typing.MatLike:
	"""Assumes the largest contour is a rectangle. 
	Finds the rotation of largest rectangle and rotates the page based on that. 
	Also returns the largest rectangle for use in future scaling"""
	
	big=largest_cnt(page)
	rect = cv2.minAreaRect(big)
	if rect[2] > 45:
		angle = rect[2]-90
	else: 
		angle = rect[2]
	
	Matrix = cv2.getRotationMatrix2D((page.shape[1]//2,page.shape[0]//2),angle,1)
	rotated = cv2.warpAffine(page, Matrix, (page.shape[1],page.shape[0]))
	big=largest_cnt(rotated)
	rect = list(cv2.boundingRect(big))			#Getting the dimension of this key contour is handled here rather than a separate function
	return rotated, rect
```
**TypeScript Mapping:**
- Calls `big = largest_cnt(page)`.
- Computes `rect = cv.minAreaRect(big)`.
- Adjusts `angle = rect.angle > 45 ? rect.angle - 90 : rect.angle`.
- Rotates: `Matrix = cv.getRotationMatrix2D(new cv.Point(Math.floor(page.cols / 2), Math.floor(page.rows / 2)), angle, 1)`.
- Warps: `cv.warpAffine(page, rotated, Matrix, new cv.Size(page.cols, page.rows), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255))`.
- Recomputes `big = largest_cnt(rotated)` and returns `[rotated, [b.x, b.y, b.width, b.height]]`.

---

### 1.4 `scale(image, rect, params)`
**Python Source (lines 426-466):**
```python
def scale(image:cv2.typing.MatLike,rect: list,params: Parameters) -> cv2.typing.MatLike:
	"""Resizes the the page both up or down so that the largest contour matches 
	the size of the template largest contour."""
	
	rx,ry,rw,rh = params.rect	
	x,y,w,h = rect
	scale_x = rw/w
	scale_y = rh/h
	
	height, width, _ = image.shape
	sx,sy,sw,sh = round(x*scale_x), round(y*scale_y),round(w*scale_x),round(h*scale_y)
	image = cv2.resize(image,(round(width*scale_x),round(height*scale_y)))

	#Aligning the largest rectangle
	#Left
	if sx<rx:
		image = cv2.copyMakeBorder(image,0,0,rx-sx,0,cv2.BORDER_CONSTANT, value=(255,255,255))	
	else:
		image = image[0:image.shape[0],sx-rx:image.shape[1]]

	#Top
	if sy<ry:
		image = cv2.copyMakeBorder(image,ry-sy,0,0,0,cv2.BORDER_CONSTANT, value=(255,255,255))	
	else:
		image = image[sy-ry:height,0:image.shape[1]]
	
	#Right
	if image.shape[1]<4800:
		image = cv2.copyMakeBorder(image,0,0,0,4800-image.shape[1],cv2.BORDER_CONSTANT, value=(255,255,255))	
	else:
		image = image[0:image.shape[0],0:4800]

	#Bottom
	if image.shape[0]<6840:
		image = cv2.copyMakeBorder(image,0,6840-image.shape[0],0,0,cv2.BORDER_CONSTANT, value=(255,255,255))			
	else:
		image = image[0:6840,0:4800]

	return image
```
**TypeScript Mapping:**
Translates each branch verbatim with `cv.copyMakeBorder` or sub-mat slicing.

---

### 1.5 `get_thresh(image, blur=True)`
**Python Source (lines 468-472):**
```python
def get_thresh(image,blur=True):
	if blur:
		image = cv2.medianBlur(image,5)
	image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
	return cv2.adaptiveThreshold(image,255,cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 27,5)
```

---

### 1.6 `contour_center(contour)`
**Python Source (lines 474-478):**
```python
def	contour_center(contour):
	M = cv2.moments(contour)
	cx = int(M['m10']/M['m00'])
	cy = int(M['m01']/M['m00'])
	return [cx,cy]
```

---

### 1.7 `Parameters.set_box(self, image)`
**Python Source (lines 101-147):**
```python
def set_box(self,image):
	"""Finds the contours of the of the box. This contour is used to draw masks"""
	
	clip = get_thresh(image[int(self.box_y1):int(self.box_y2),int(self.box_x1):int(self.box_x2)],blur=False)
	
	outer, _ = cv2.findContours(clip,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
	outer = outer[0]
	
	extra = 0
	check_area = 0
	outer_area = cv2.contourArea(outer)
	while abs(check_area - outer_area)>10:
		outer_area = 0 + check_area
		check_img = get_thresh(image[int(self.box_y1-extra):int(self.box_y2+extra*2),int(self.box_x1-extra):int(self.box_x2+extra*2)],blur=True)
		check_outer, _ = cv2.findContours(check_img,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
		check_outer = check_outer[0]
		check_area = cv2.contourArea(check_outer)
		outer = check_outer
		extra+=1
	outer = cv2.approxPolyDP(check_outer, 0.05*cv2.arcLength(outer, True), True)

	percentage = abs(area(outer)-((self.box_y2-self.box_y1)*(self.box_x2-self.box_x1)))/area(outer)
	if percentage>1:
		print(percentage)
		raise Exception("The area of the contour does not match the area of the selection")		
	
	x, y, w, h = cv2.boundingRect(outer)
	clip = cv2.bitwise_not(check_img)		
	clip = cv2.drawContours(clip,[outer],-1,0,w//6)
	clip = clip[y:y+h,x:x+w]

	inner, _ = cv2.findContours(clip,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
	inner = inner[0]
	if len(inner)==0:
		print(len(inner))
		raise Exception("Inner contours does not return a usable shape")
	self.h = h
	self.w = w
	self.outer = outer-contour_center(outer)
	self.inner = inner-contour_center(inner)
	self.fill_limit = 5.5*(cv2.contourArea(self.inner))**0.5
```
**TypeScript Mapping:**
Stores centered point arrays for `outer` and `inner`, along with `h, w, fill_limit`.

---

### 1.8 `find_boxes(q_area, params)`
**Python Source (lines 480-511):**
```python
def find_boxes(q_area,params):
	"""Goes through contour and returns List of only those of similar size to user defined box."""

	boxes = []
	thresh = get_thresh(q_area)
	cnts,hier = cv2.findContours(thresh,cv2.RETR_CCOMP,cv2.CHAIN_APPROX_SIMPLE)

	sorted_cnts = [c for i, c in enumerate(cnts) if hier[0][i][3]==-1]
	sorted_cnts = sorted(sorted_cnts, key=area, reverse=True)

	limit =int(0.9*params.h*params.w)
	min_w= int(params.w*0.8)
	min_h = int(params.h*0.8)
	max_w = int(params.w*1.3)
	max_h = int(params.h*1.3)
	version = None
	if params.w>params.h*2:
		version = "narrow"
	for c in sorted_cnts:
		_, _, w, h = cv2.boundingRect(c)
		if w*h<limit:	
			break
		if min_w<=w<=max_w and min_h<=h<=max_h: 
			boxes.append(contour_center(c))
			continue
		if version == "narrow":
			continue
		if h<params.h*4.5:
			erode_messy(c,q_area,params,boxes)
	return boxes
```

---

### 1.9 `erode_messy(c, q_area, params, boxes)` and `slice_messy`
**Python Source (lines 513-549):**
```python
def erode_messy(c,q_area,params,boxes):
	erode_mask = numpy.zeros(q_area.shape, dtype="uint8") 
	erode_mask = cv2.drawContours(erode_mask,[c],-1,(255,255,255),-1) 						
	kernel = numpy.ones((31, 31), numpy.uint8)
	erode_mask = cv2.erode(erode_mask,kernel=kernel,iterations=1)
	erode_mask = cv2.cvtColor(erode_mask,cv2.COLOR_BGR2GRAY) 
	erode_cnts,_= cv2.findContours(erode_mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
	for e_cnt in erode_cnts: 
		x, y, w, h = cv2.boundingRect(e_cnt)
		if params.w*0.5 <= w <= params.w*1.5 and params.h*0.5 <= h <= params.h*1.5:
			boxes.append(contour_center(e_cnt))
			continue
		slice_messy(q_area,e_cnt,params,x,y,w,h,boxes)

def slice_messy(q_area,e_cnt,params,x,y,w,h,boxes):
	slice_mask = numpy.zeros(q_area.shape, dtype="uint8") 
	slice_mask = cv2.drawContours(slice_mask,[e_cnt],-1,(255,255,255),-1)
	x_scale = w//params.w+1
	y_scale = h//params.h
	j=1
	while j<x_scale:
		cv2.line(slice_mask,(x+j*w//x_scale,y-10),(x+j*w//x_scale,y+h+10),(0,0,0),15)
		j+=1
	k=1
	while k<y_scale:
		cv2.line(slice_mask,(x-10,y+k*h//y_scale),(x+w+10,y+k*h//y_scale),(0,0,0),15)
		k+=1
	slice_mask = cv2.cvtColor(slice_mask,cv2.COLOR_RGB2GRAY)

	slice_cnts,_= cv2.findContours(slice_mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)		
	for s_cnt in slice_cnts: 
		_, _, sw, sh = cv2.boundingRect(s_cnt)
		if params.w*0.5 <= sw <= params.w*1.5 and params.h*0.5 <= sh <= params.h*1.5:
			boxes.append(contour_center(s_cnt))
```

---

### 1.10 `sort_into_columns(boxes, params)`
**Python Source (lines 550-591):**
```python
def sort_into_columns(boxes,params: Parameters):
	columns = [[]]
	boxes = sorted(boxes, key=operator.itemgetter(0))
	
	prev_x=0
	col_index = 0
	for i, box in enumerate(boxes):	 
		x,_ = box
		if abs(x-prev_x) > params.w//2 and i>0:
			col_index +=1
			columns.append([])
		columns[col_index].append(box)
		prev_x = x
		
	columns = [c for c in columns if len(c) > 2]
	
	col_avg=[]
	for c, column in enumerate(columns):
		columns[c] = sorted(column, key=operator.itemgetter(1))
		x_pos=[]
		for r in columns[c]:
			x_pos.append(r[0])
		if len(x_pos):
			avg = sum(x_pos)/len(x_pos)
			col_avg.append(int(avg))
	params.col_avg = col_avg
	params.x_jump = int((col_avg[-1]-col_avg[0])/len(col_avg))

	prev = col_avg[0]
	for i, x_pos in enumerate(col_avg):
		if x_pos-prev>params.x_jump*1.2:
			params.choices=i
			break
		prev=x_pos
		params.choices=i+1
	filtered_boxes = [box for column in columns for box in column]
	return columns,filtered_boxes
```

---

### 1.11 `sort_into_rows(boxes, params)`
**Python Source (lines 593-646):**
```python
def sort_into_rows(boxes,params):
	rows = [[]]
	boxes = sorted(boxes, key=operator.itemgetter(1))

	prev_y=0
	row_index = 0
	for i, box in enumerate(boxes):	 
		_,y= box
		if abs(y-prev_y) > 0.95*params.h and i>0:
			row_index +=1
			rows.append([])
		rows[row_index].append(box)
		prev_y = y	

	rows = [r for r in rows if len(r) > 2]
	
	row_avg=[]
	for r, row in enumerate(rows):
		rows[r] = sorted(row, key=operator.itemgetter(0))
		y_pos=[]
		for c in rows[r]:
			_,y = c
			y_pos.append(y)

		avg = sum(y_pos)/len(y_pos)
		row_avg.append(int(avg))
	params.row_avg = row_avg
	if len(row_avg) > 1:
		gaps = [row_avg[i+1] - row_avg[i] for i in range(len(row_avg) - 1)]
		gaps.sort()

		n = len(gaps)
		params.y_jump = (
			0 if n == 0 else
			gaps[n//2] if n % 2 else
			int((gaps[n//2 - 1] + gaps[n//2]) / 2)
		)
	else:
		params.y_jump = 0
```

---

### 1.12 `missing(columns, params, img)`
**Python Source (lines 680-705):**
```python
def missing(columns, params, img):
	columns_copy=columns.copy()
	for c, column in enumerate(columns_copy):
		offset=0
		for r, row in enumerate(column):
			x,y = row

			if 30<abs(y-params.row_avg[r+offset])<int(params.y_jump-30):
				columns[c].pop(r+offset)
				offset-=1
			if 10<abs(y-params.row_avg[r+offset])<int(params.y_jump-10):
				columns[c][r+offset]=[x,params.row_avg[r+offset]]			
			elif abs(y-params.row_avg[r+offset])>params.h:
				column.insert(r,[x,params.row_avg[r+offset]])
				
		m=-1		
		while len(params.row_avg)>len(column):
			column.append([params.col_avg[c],params.row_avg[m]])
			m-=1
		columns[c] = column
	return (columns)
```

---

### 1.13 `find_questions(columns, params)`
**Python Source (lines 707-728):**
```python
def find_questions(columns,params):
	stack = [[]]*params.choices
	for c, column in enumerate(columns):
		index = c%params.choices
		stack[index]= stack[index]+column
	questions=[]
	
	for r,row in enumerate(stack[0]):
		question = Question(r)
		for c,column in enumerate(stack):
			try:
				box = Question.Box(column[r],c)
				question.boxes.append(box)
			except:
				print("column",r,c)
		questions.append(question)
	if params.key:
		questions = questions[:len(params.key)]
				
	return questions
```

---

### 1.14 `find_responses(student, image, params)`
**Python Source (lines 730-746) & `Box.fill` (lines 30-39):**
```python
def find_responses(student: Student,image,params: Parameters):
	thresh = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
	thresh = cv2.threshold(thresh,0,255,cv2.THRESH_BINARY_INV| cv2.THRESH_OTSU)[1] 
	
	for question in student.questions:
		filled = 0	
		for box in question.boxes:
			box.fill(params,thresh)
			if box.bool:
				filled+=1
		if filled > 1:			
			question.response = False		
			student.incomplete.append(question)	
		else:
			question.get_response()

# Box.fill:
def fill(self,params,thresh):
	contour = params.inner + self.xy
	x,y,w,h= cv2.boundingRect(contour)
	temp = thresh[y:y+h,x:x+w]
	mask = numpy.zeros(temp.shape, dtype="uint8") 
	mask = cv2.bitwise_and(temp, temp, mask)
	if cv2.countNonZero(mask) > params.fill_limit:
		self.bool = True
		self.colour = "yellow"
```

---

### 1.15 `annotate` & `add_markup`
**Python Source (lines 291-316):**
```python
def annotate(self,params,image):
	for question in self.questions:
		if question.response=="Blank" or not question.response:
			continue
		for box in question.boxes:
			if box.bool:
				cv2.drawContours(image, [box.xy+params.outer], -1, Student.colours.get(box.colour), 5,cv2.LINE_AA)
	return image

def add_markup(self,image,params):
	for question in self.questions:
		if question.number>len(params.key)-1:
			break
		if params.key[question.number] == question.response:
			question.response_box.colour="green"
			self.score+=1
		x,y=question.boxes[ord(params.key[question.number])-65].xy
		text_y = y+params.text_shift[1]
		text_x = x+params.text_shift[0]
		cv2.putText(image,params.key[question.number], (text_x,text_y),cv2.FONT_HERSHEY_SIMPLEX, params.font_size,(255,255,255),20,lineType=cv2.LINE_AA) 
		cv2.putText(image,params.key[question.number], (text_x,text_y),cv2.FONT_HERSHEY_SIMPLEX, params.font_size,Student.colours.get("green"),7,lineType=cv2.LINE_AA) 
	if all(self.responses):
		score_size = cv2.getTextSize(f"Score =  {self.score} / {len(params.key)}",cv2.FONT_HERSHEY_SIMPLEX, 5,7)[0]
		self.scan = cv2.putText(self.scan,f"Score = {self.score} / {len(params.key)}",(4644-score_size[0],700),cv2.FONT_HERSHEY_SIMPLEX, 5,(255,255,255),15,cv2.LINE_AA)
		self.scan= cv2.putText(self.scan,f"Score = {self.score} / {len(params.key)}",(4644-score_size[0],700),cv2.FONT_HERSHEY_SIMPLEX, 5,(0,0,0),7,cv2.LINE_AA)		
	return image
```
